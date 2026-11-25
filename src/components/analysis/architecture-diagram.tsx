"use client";

// code와 fullCode에는 buildPlanDiagrams가 카탈로그 이름으로 만든 문자열만 전달한다.
// 모델이 쓴 글이나 사용자 입력을 Mermaid 코드로 전달하지 않는다.
import { useEffect, useId, useRef, useState, type JSX } from "react";
import { Dialog } from "radix-ui";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import type { DiagramEdge } from "@/components/analysis/diagram-edges";

export type ArchitectureDiagramProps = {
  // 카드에 그리는 정의. fullCode가 없으면 "크게 보기"에도 같은 그림을 쓴다.
  code: string;
  fullCode?: string;
  label: string;
  edges?: DiagramEdge[];
};

type Rendered = { code: string; fullCode: string; svgs: { preview: string; large: string } | null };

// 세 카드와 StrictMode의 중복 effect가 같은 지연 로딩을 공유한다.
let mermaidModule: Promise<typeof import("mermaid")> | undefined;

export function ArchitectureDiagram({ code, fullCode = code, label, edges }: ArchitectureDiagramProps): JSX.Element {
  const { t } = useI18n();
  const id = useId();
  const sequence = useRef(0);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const current = rendered?.code === code && rendered.fullCode === fullCode ? rendered : null;

  useEffect(() => {
    let active = true;

    async function draw() {
      let scratch: HTMLDivElement | undefined;
      const renderId = `architecture-${id.replace(/[^a-zA-Z0-9_-]/g, "")}-${++sequence.current}`;
      try {
        mermaidModule ??= import("mermaid").catch((error: unknown) => {
          mermaidModule = undefined;
          throw error;
        });
        const { default: mermaid } = await mermaidModule;
        // 글꼴이 준비된 뒤 노드 크기를 재야 한글 라벨이 잘리지 않는다.
        await document.fonts?.ready;
        if (!active) return;

        const styles = getComputedStyle(document.documentElement);
        const color = (token: string) => styles.getPropertyValue(`--color-${token}`).trim();
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: "base",
          look: "classic",
          themeVariables: {
            darkMode: true,
            background: color("canvas"),
            primaryColor: color("surface-2"),
            primaryTextColor: color("ink"),
            primaryBorderColor: color("border-strong"),
            secondaryColor: color("surface-1"),
            tertiaryColor: color("canvas"),
            lineColor: color("muted"),
            textColor: color("body"),
            edgeLabelBackground: color("canvas"),
            fontFamily: getComputedStyle(document.body).fontFamily,
            fontSize: "12px",
          },
          flowchart: { htmlLabels: false, useMaxWidth: true },
        });

        // Mermaid의 측정용 DOM과 오류 SVG는 이 렌더링에만 속하며 항상 제거한다.
        scratch = document.createElement("div");
        scratch.setAttribute("aria-hidden", "true");
        scratch.style.position = "absolute";
        scratch.style.left = "-10000px";
        document.body.appendChild(scratch);
        const { svg: preview } = await mermaid.render(renderId, code, scratch);
        // 큰 그림도 같은 문서에 들어가므로 ID와 그 ID를 쓰는 스타일·마커 참조가 카드 그림과 겹치지 않게 한다.
        // 정의가 같거나 큰 그림만 실패하면 카드 그림의 ID만 바꿔 원래 크기로 보여 준다.
        const largeId = `${renderId}-large`;
        let large = preview.replaceAll(renderId, largeId);
        if (fullCode !== code && active) {
          try {
            large = (await mermaid.render(largeId, fullCode, scratch)).svg;
          } catch {
            // 카드 그림으로 대신한다.
          }
        }
        if (active) setRendered({ code, fullCode, svgs: { preview, large } });
      } catch {
        if (active) setRendered({ code, fullCode, svgs: null });
      } finally {
        scratch?.remove();
      }
    }

    void draw();
    return () => { active = false; };
  }, [code, fullCode, id]);

  if (!current?.svgs) {
    return (
      <>
      <div role="status" aria-label={label} className="diagram-placeholder flex h-[120px] items-center justify-center rounded-md border border-hairline px-3 text-center text-[11px] text-subtle">
        {current ? t("analysis.result.diagramFailed") : t("analysis.result.diagramDrawing")}
      </div>
      {edges && <ul aria-label={t("analysis.result.connections", { label })} className="sr-only">{edges.map((edge, index) => <li key={`${edge.from}\0${edge.to}\0${index}`}>{edge.from} → {edge.to}</li>)}</ul>}
      </>
    );
  }

  // 카드의 좁은 자리에서는 글자가 작아지므로 원래 크기 그림을 대화상자로 연다.
  const viewBoxWidth = (svg: string) => Number(/viewBox="[\d.-]+\s+[\d.-]+\s+([\d.]+)/.exec(svg)?.[1]) || undefined;
  const naturalWidth = viewBoxWidth(current.svgs.preview);
  const largeWidth = viewBoxWidth(current.svgs.large);

  return (
    <>
    <Dialog.Root>
      <div className="relative">
        {/* 아래 여백은 "크게 보기" 버튼 자리다. 그림의 마지막 줄 노드를 버튼이 가리지 않는다. */}
        <div role="img" aria-label={label} className="min-h-[120px] overflow-x-auto rounded-md border border-hairline bg-canvas p-2 pb-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" tabIndex={0}>
          {/* strict 모드로 생성한 SVG만 삽입하며 이벤트 바인딩은 사용하지 않는다. */}
          <div aria-hidden="true" style={naturalWidth ? { minWidth: `${naturalWidth * 0.75}px` } : undefined} className="w-full [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-none" dangerouslySetInnerHTML={{ __html: current.svgs.preview }} />
        </div>
        <Dialog.Trigger asChild>
          <Button type="button" variant="secondary" size="xs" aria-label={t("analysis.result.viewLargerLabel", { label })} className="absolute right-2 bottom-2">
            {t("analysis.result.viewLarger")}
          </Button>
        </Dialog.Trigger>
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-canvas/80" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[calc(100vw-32px)] max-w-[1100px] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border border-border-strong bg-surface-1 p-6 text-sm text-body">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Dialog.Title className="text-lg leading-[1.3] font-semibold text-ink">{label}</Dialog.Title>
              <Dialog.Description className="text-[13px] text-subtle">
                {t("analysis.result.originalSize")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button type="button" variant="outline" size="sm">{t("analysis.result.close")}</Button>
            </Dialog.Close>
          </div>
          <div role="img" aria-label={label} tabIndex={0} className="min-h-0 overflow-auto rounded-md border border-hairline bg-canvas p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
            <div
              aria-hidden="true"
              style={{ width: largeWidth }}
              className="mx-auto [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-none"
              dangerouslySetInnerHTML={{ __html: current.svgs.large }}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    {edges && <ul aria-label={t("analysis.result.connections", { label })} className="sr-only">{edges.map((edge, index) => <li key={`${edge.from}\0${edge.to}\0${index}`}>{edge.from} → {edge.to}</li>)}</ul>}
    </>
  );
}

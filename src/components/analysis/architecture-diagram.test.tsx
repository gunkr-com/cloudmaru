import { renderWithI18n as render } from "@/test/render-with-i18n";
import { StrictMode } from "react";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArchitectureDiagram } from "@/components/analysis/architecture-diagram";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn<(id: string, code: string, container?: Element) => Promise<{ svg: string }>>(),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

const code = 'flowchart LR\n  n0["웹 앱"]\n  n1["사용자"]\n  n1 --> n0';
const label = "균형 안 아키텍처 다이어그램";
const svg = '<svg viewBox="0 0 100 40"><text>웹 앱</text></svg>';
const colors = {
  "--color-canvas": "#101112",
  "--color-surface-1": "#202122",
  "--color-surface-2": "#303132",
  "--color-ink": "#f1f2f3",
  "--color-body": "#d1d2d3",
  "--color-muted": "#b1b2b3",
  "--color-subtle": "#919293",
  "--color-border-strong": "rgba(178, 182, 189, 0.25)",
};

function deferred() {
  let resolve!: (value: { svg: string }) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<{ svg: string }>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mermaid.initialize.mockReset();
  mermaid.render.mockReset().mockResolvedValue({ svg });
  for (const [name, value] of Object.entries(colors)) document.documentElement.style.setProperty(name, value);
  document.body.style.fontFamily = "Pretendard Variable, sans-serif";
});

afterEach(() => {
  for (const name of Object.keys(colors)) document.documentElement.style.removeProperty(name);
  document.body.style.removeProperty("font-family");
});

describe("ArchitectureDiagram", () => {
  it("그리는 동안 높이 120px의 줄무늬 자리를 표시하고 완료되면 접근 가능한 SVG로 바꾼다", async () => {
    const pending = deferred();
    mermaid.render.mockReturnValueOnce(pending.promise);
    render(<ArchitectureDiagram code={code} label={label} />);

    expect(screen.getByRole("status")).toHaveClass("diagram-placeholder", "h-[120px]", "rounded-md", "border-hairline");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledOnce());
    await act(async () => pending.resolve({ svg }));

    const diagram = screen.getByRole("img", { name: label });
    expect(diagram.querySelector("svg")).toBeInTheDocument();
    expect(diagram).toHaveTextContent("웹 앱");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mermaid.render.mock.calls[0][1]).toBe(code);
  });

  it.each(["pending", "success", "failure"] as const)("%s 상태에서도 연결 관계 대체 텍스트를 제공한다", async (state) => {
    const edges = [{ from: "사용자", to: "웹 앱" }];
    if (state === "pending") {
      const pending = deferred();
      mermaid.render.mockReturnValueOnce(pending.promise);
      const view = render(<ArchitectureDiagram code={code} label={label} edges={edges} />);
      expect(screen.getByRole("list", { name: `${label} 연결 관계` })).toHaveTextContent("사용자 → 웹 앱");
      await waitFor(() => expect(mermaid.render).toHaveBeenCalledOnce());
      await act(async () => pending.resolve({ svg }));
      view.unmount();
    } else {
      if (state === "failure") mermaid.render.mockRejectedValueOnce(new Error("실패"));
      const view = render(<ArchitectureDiagram code={code} label={label} edges={edges} />);
      if (state === "failure") await screen.findByText("다이어그램을 표시하지 못했습니다.");
      else await screen.findByRole("img", { name: label });
      expect(screen.getByRole("list", { name: `${label} 연결 관계` })).toHaveTextContent("사용자 → 웹 앱");
      view.unmount();
    }
  });

  it("넓은 그림은 최소 120px 높이와 viewBox의 75% 너비를 유지한다", async () => {
    mermaid.render.mockResolvedValueOnce({ svg: '<svg viewBox="0 0 1200 600"></svg>' });
    render(<ArchitectureDiagram code={code} label={label} />);
    const preview = await screen.findByRole("img", { name: label });
    expect(preview).toHaveClass("min-h-[120px]");
    expect(preview).not.toHaveClass("h-[120px]");
    const scroll = preview as HTMLElement;
    expect(scroll.firstElementChild).toHaveStyle({ minWidth: "900px" });
    expect(scroll).toHaveAttribute("tabindex", "0");
  });

  it("좁은 그림은 가운데에 두고 '크게 보기' 버튼 자리를 그림 아래에 비워 둔다", async () => {
    render(<ArchitectureDiagram code={code} label={label} />);
    const preview = await screen.findByRole("img", { name: label });
    expect(preview).toHaveClass("pb-10");
    expect(preview.firstElementChild).toHaveClass("[&_svg]:mx-auto");
    expect(screen.getByRole("button", { name: `${label} 크게 보기` })).toHaveClass("h-6", "bottom-2");
  });

  it("자동 실행 없이 strict 모드와 CSS 변수의 다크 색·글꼴을 사용한다", async () => {
    render(<ArchitectureDiagram code={code} label={label} />);
    await screen.findByRole("img", { name: label });

    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: expect.objectContaining({
        darkMode: true,
        background: colors["--color-canvas"],
        primaryColor: colors["--color-surface-2"],
        primaryTextColor: colors["--color-ink"],
        lineColor: colors["--color-muted"],
        fontFamily: getComputedStyle(document.body).fontFamily,
      }),
    }));
  });

  it.each(["initialize", "render"] as const)("%s 실패는 자리 블록과 한국어 안내로 처리한다", async (stage) => {
    if (stage === "initialize") mermaid.initialize.mockImplementationOnce(() => { throw new Error("초기화 실패"); });
    else mermaid.render.mockRejectedValueOnce(new Error("렌더링 실패"));
    render(<ArchitectureDiagram code={code} label={label} />);

    expect(await screen.findByText("다이어그램을 표시하지 못했습니다.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveClass("diagram-placeholder", "h-[120px]");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    const scratch = mermaid.render.mock.calls[0]?.[2];
    if (scratch) expect(scratch).not.toBeInTheDocument();
  });

  it("동시에 그리는 세 안은 서로 다른 CSS 선택자 안전 ID를 사용한다", async () => {
    render(<StrictMode>{["최저 비용", "균형", "고가용성"].map((tier) => (
      <ArchitectureDiagram key={tier} code={code} label={`${tier} 안 아키텍처 다이어그램`} />
    ))}</StrictMode>);
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(3));

    const ids = mermaid.render.mock.calls.map(([id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(id).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]*$/));
    mermaid.render.mock.calls.forEach(([, , scratch]) => {
      if (scratch) expect(scratch).not.toBeInTheDocument();
    });
  });

  it("code 변경 시 새 그림을 표시하고 늦게 완료된 이전 그림은 무시한다", async () => {
    const previous = deferred();
    const next = deferred();
    mermaid.render.mockReturnValueOnce(previous.promise).mockReturnValueOnce(next.promise);
    const { rerender } = render(<ArchitectureDiagram code={code} label={label} />);
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));

    const nextCode = 'flowchart LR\n  n0["새 웹 앱"]';
    rerender(<ArchitectureDiagram code={nextCode} label={label} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2));
    await act(async () => next.resolve({ svg: '<svg><text>새 웹 앱</text></svg>' }));
    await act(async () => previous.resolve({ svg }));

    expect(screen.getByRole("img", { name: label })).toHaveTextContent("새 웹 앱");
    expect(mermaid.render.mock.calls[1][1]).toBe(nextCode);
    expect(mermaid.render.mock.calls[1][0]).not.toBe(mermaid.render.mock.calls[0][0]);
  });

  it("성공한 그림도 code가 바뀌면 자리를 표시하고 새 렌더링 실패를 처리한다", async () => {
    const next = deferred();
    const { rerender } = render(<ArchitectureDiagram code={code} label={label} />);
    await screen.findByRole("img", { name: label });
    mermaid.render.mockReturnValueOnce(next.promise);
    rerender(<ArchitectureDiagram code={`${code}\n  n2["저장소"]`} label={label} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2));
    await act(async () => next.reject(new Error("렌더링 실패")));
    expect(screen.getByText("다이어그램을 표시하지 못했습니다.")).toBeInTheDocument();
  });

  it("카드의 작은 그림 옆 '크게 보기'로 원래 크기 다이어그램을 대화상자에 연다", async () => {
    const user = userEvent.setup();
    mermaid.render.mockImplementation(async (renderId) => ({
      svg: `<svg id="${renderId}" viewBox="0 0 656 468" style="max-width: 656px;"><style>#${renderId} .node{fill:red}</style><text>웹 앱</text></svg>`,
    }));
    render(<ArchitectureDiagram code={code} label={label} />);
    const preview = await screen.findByRole("img", { name: label });
    expect(preview).toHaveClass("min-h-[120px]");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: `${label} 크게 보기` });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: label });
    const large = within(dialog).getByRole("img", { name: label });
    expect(large).toHaveAttribute("tabindex", "0");
    expect(large).toHaveTextContent("웹 앱");
    // 원래 크기(viewBox 폭)로 그리고, 화면보다 넓으면 이 영역만 가로로 스크롤한다.
    const canvas = large.firstElementChild as HTMLElement;
    expect(canvas.style.width).toBe("656px");
    expect(large).toHaveClass("overflow-auto");
    // 같은 SVG를 두 번 넣어도 ID와 그 ID를 쓰는 스타일이 겹치지 않는다.
    const previewId = preview.querySelector("svg")!.id;
    const largeSvg = large.querySelector("svg")!;
    expect(largeSvg.id).not.toBe(previewId);
    expect(largeSvg.querySelector("style")!.textContent).toContain(`#${largeSvg.id} `);
    expect(document.querySelectorAll(`[id="${previewId}"]`)).toHaveLength(1);

    await user.click(within(dialog).getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  describe("카드 그림과 큰 그림의 정의가 다를 때", () => {
    const fullCode = `${code}\n  subgraph extra["부가·과금 항목"]\n    n2["로그 수집"]\n  end\n  n0 ~~~ extra`;
    const svgFor = (renderId: string, source: string) => source === fullCode
      ? `<svg id="${renderId}" viewBox="0 0 900 500"><style>#${renderId} .node{fill:red}</style><text>부가·과금 항목</text></svg>`
      : `<svg id="${renderId}" viewBox="0 0 400 300"><style>#${renderId} .node{fill:red}</style><text>웹 앱</text></svg>`;

    it("카드에는 code를, 대화상자에는 fullCode를 서로 다른 ID로 그린다", async () => {
      const user = userEvent.setup();
      mermaid.render.mockImplementation(async (renderId, source) => ({ svg: svgFor(renderId, source) }));
      render(<ArchitectureDiagram code={code} fullCode={fullCode} label={label} />);
      const preview = await screen.findByRole("img", { name: label });

      expect(mermaid.render.mock.calls.map(([, source]) => source)).toEqual([code, fullCode]);
      expect(preview).toHaveTextContent("웹 앱");
      expect(preview).not.toHaveTextContent("부가·과금 항목");
      expect(preview.firstElementChild).toHaveStyle({ minWidth: "300px" });
      expect(preview.querySelectorAll('svg[id^="architecture"]')).toHaveLength(1);

      await user.click(screen.getByRole("button", { name: `${label} 크게 보기` }));
      const large = within(screen.getByRole("dialog", { name: label })).getByRole("img", { name: label });
      expect(large).toHaveTextContent("부가·과금 항목");
      expect((large.firstElementChild as HTMLElement).style.width).toBe("900px");
      const largeSvg = large.querySelector("svg")!;
      expect(largeSvg.id).not.toBe(preview.querySelector("svg")!.id);
      expect(largeSvg.querySelector("style")!.textContent).toContain(`#${largeSvg.id} `);
      const ids = [...document.querySelectorAll("svg[id]")].map(({ id }) => id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("큰 그림만 실패하면 대화상자에 카드 그림을 원래 크기로 보여 준다", async () => {
      const user = userEvent.setup();
      mermaid.render.mockImplementation(async (renderId, source) => {
        if (source === fullCode) throw new Error("렌더링 실패");
        return { svg: svgFor(renderId, source) };
      });
      render(<ArchitectureDiagram code={code} fullCode={fullCode} label={label} />);
      const preview = await screen.findByRole("img", { name: label });
      expect(preview).toHaveTextContent("웹 앱");

      await user.click(screen.getByRole("button", { name: `${label} 크게 보기` }));
      const large = within(screen.getByRole("dialog", { name: label })).getByRole("img", { name: label });
      expect(large).toHaveTextContent("웹 앱");
      expect((large.firstElementChild as HTMLElement).style.width).toBe("400px");
      expect(large.querySelector("svg")!.id).not.toBe(preview.querySelector("svg")!.id);
    });

    it("fullCode가 code와 같으면 한 번만 그린다", async () => {
      render(<ArchitectureDiagram code={code} fullCode={code} label={label} />);
      await screen.findByRole("img", { name: label });
      expect(mermaid.render).toHaveBeenCalledOnce();
    });

    it("fullCode만 바뀌어도 다시 그린다", async () => {
      mermaid.render.mockImplementation(async (renderId, source) => ({ svg: svgFor(renderId, source) }));
      const { rerender } = render(<ArchitectureDiagram code={code} label={label} />);
      await screen.findByRole("img", { name: label });
      rerender(<ArchitectureDiagram code={code} fullCode={fullCode} label={label} />);
      await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(3));
      expect(mermaid.render.mock.calls.slice(1).map(([, source]) => source)).toEqual([code, fullCode]);
    });
  });

  it("그리는 중이거나 실패한 자리에는 '크게 보기'가 없다", async () => {
    const pending = deferred();
    mermaid.render.mockReturnValueOnce(pending.promise);
    render(<ArchitectureDiagram code={code} label={label} />);
    expect(screen.queryByRole("button", { name: /크게 보기/ })).not.toBeInTheDocument();
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledOnce());
    await act(async () => pending.reject(new Error("렌더링 실패")));
    expect(screen.getByText("다이어그램을 표시하지 못했습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /크게 보기/ })).not.toBeInTheDocument();
  });

  it("언마운트 뒤 렌더링이 끝나도 SVG나 임시 DOM을 남기지 않는다", async () => {
    const pending = deferred();
    mermaid.render.mockReturnValueOnce(pending.promise);
    const { unmount } = render(<ArchitectureDiagram code={code} label={label} />);
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledOnce());
    unmount();
    await act(async () => pending.resolve({ svg }));

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    const scratch = mermaid.render.mock.calls[0][2];
    if (scratch) expect(scratch).not.toBeInTheDocument();
  });
});


it("영어 다이어그램 안내와 대화상자를 표시한다", async () => {
  const user = userEvent.setup();
  render(<ArchitectureDiagram code={code} label="Balanced option architecture diagram" edges={[{ from: "Users", to: "App" }]} />, { locale: "en" });
  expect(screen.getByText("Drawing the architecture diagram.")).toBeInTheDocument();
  await screen.findByRole("img");
  expect(screen.getByRole("list", { name: "Balanced option architecture diagram connections" })).toHaveTextContent("Users → App");
  await user.click(screen.getByRole("button", { name: "View larger: Balanced option architecture diagram" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Shown at original size.");
  await user.click(screen.getByRole("button", { name: "Close" }));
});

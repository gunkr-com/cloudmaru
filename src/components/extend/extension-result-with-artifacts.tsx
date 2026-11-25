"use client";

import { ExtensionArtifactPanel } from "@/components/extend-artifacts/extension-artifact-panel";
import { ExtensionResultView, type ExtensionResultViewProps } from "./extension-result";

/** 선택 callback은 클라이언트 경계 안에 두고 저장 ID/안마다 패널을 새로 마운트한다. */
export function ExtensionResultWithArtifacts(props: Omit<ExtensionResultViewProps, "renderArtifacts">) {
  return <ExtensionResultView key={props.display.result.id} {...props}
    renderArtifacts={({ extensionId, tier }) => <ExtensionArtifactPanel key={`${extensionId}:${tier}`} extensionId={extensionId} tier={tier} />} />;
}

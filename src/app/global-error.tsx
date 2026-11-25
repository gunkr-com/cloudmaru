"use client";

import { MESSAGES } from "@/i18n/messages";
import Link from "next/link";
import type { JSX } from "react";
import "./globals.css";

// 루트 레이아웃이 실패하면 이 컴포넌트가 문서 전체를 대신한다. 루트 레이아웃의 html·body·전역 스타일이 없으므로 직접 넣는다.
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }): JSX.Element {
  return (
    <html lang="en">
      <head>
        <title>{MESSAGES.en.common.siteName}</title>
      </head>
      <body className="min-h-screen bg-canvas font-sans text-body antialiased">
        <main id="main" className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 px-6 py-12">
          <section role="alert" className="space-y-3">
            <h1 className="text-2xl font-semibold text-ink"><span lang="en" className="block">{MESSAGES.en.common.loadError}</span><span lang="ko" className="block">{MESSAGES.ko.common.loadError}</span></h1>
            <p className="text-sm leading-relaxed text-muted"><span lang="en" className="block">{MESSAGES.en.common.loadErrorHelp}</span><span lang="ko" className="block">{MESSAGES.ko.common.loadErrorHelp}</span></p>
          </section>
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" onClick={retry} className="min-h-10 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"><span lang="en" className="block">{MESSAGES.en.common.retry}</span><span lang="ko" className="block">{MESSAGES.ko.common.retry}</span></button>
            <Link href="/analyses/new" className="text-sm text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"><span lang="en" className="block">{MESSAGES.en.common.newAnalysis}</span><span lang="ko" className="block">{MESSAGES.ko.common.newAnalysis}</span></Link>
          </div>
        </main>
      </body>
    </html>
  );
}

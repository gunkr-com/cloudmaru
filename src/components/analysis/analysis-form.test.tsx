import { I18nProvider } from "@/i18n/provider";
import { renderWithI18n as render } from "@/test/render-with-i18n";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AnalysisForm } from "@/components/analysis/analysis-form";
import {
  AVAILABILITY_DESCRIPTIONS,
  AVAILABILITY_OPTIONS,
  EXPECTED_USERS_HELP,
  EXPECTED_USERS_OPTIONS,
} from "@/lib/analysis/input-schema";
import type { AnalysisInput } from "@/types/analysis";
import { DRAFT_STORAGE_PREFIX } from "@/lib/form/draft";

const validInput: AnalysisInput = {
  description: "회원 1만 명 규모의 예약 웹 서비스입니다. PostgreSQL을 씁니다.",
  expectedUsers: "under-10k",
  monthlyBudget: 300_000, region: "canadacentral",
  availability: "medium",
};

// jsdom에는 레이아웃 관찰 API가 없다. Radix의 폼용 숨김 입력 크기 관찰만 대체한다.
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  // jsdom 미구현인 requestSubmit을 제출 이벤트로 대체해 키보드 제출을 검증한다.
  HTMLFormElement.prototype.requestSubmit = function requestSubmit() {
    fireEvent.submit(this);
  };
});
afterAll(() => vi.unstubAllGlobals());

describe("AnalysisForm", () => {
  it("links the missing-key error to this workspace's settings while keeping the input", () => {
    render(<AnalysisForm workspaceId="company-a" defaultValues={validInput} onSubmit={vi.fn()} errorMessage="workspace.claude.unavailable" />, { locale: "en" });
    expect(screen.getByRole("alert")).toHaveTextContent("dedicated Claude key");
    expect(screen.getByRole("link", { name: "Configure Claude key" })).toHaveAttribute("href", "/workspaces/company-a/claude");
    expect(screen.getByLabelText("What service are you building?")).toHaveValue(validInput.description);
  });

  it("draftKey 초안을 저장하고 복원하며 defaultValues보다 우선한다", async () => {
    const user = userEvent.setup();
    const storageKey = `${DRAFT_STORAGE_PREFIX}restore`;
    sessionStorage.setItem(storageKey, JSON.stringify({ description: validInput.description, expectedUsers: "under-10k", monthlyBudget: "1,500,000", region: "canadacentral", availability: "medium" }));
    const { unmount } = render(<AnalysisForm draftKey="restore" defaultValues={{ description: "기본 입력" }} onSubmit={vi.fn()} />);
    // 초안 복원은 마운트 뒤 microtask에서 커밋되므로 값이 바뀔 때까지 기다린다.
    const description = await screen.findByLabelText("어떤 서비스를 만드시나요?");
    await waitFor(() => expect(description).toHaveValue(validInput.description));
    await user.type(description, " 수정");
    expect(JSON.parse(sessionStorage.getItem(storageKey)!).description).toContain(" 수정");
    unmount();
    render(<AnalysisForm draftKey="restore" onSubmit={vi.fn()} />);
    const restored = await screen.findByLabelText("어떤 서비스를 만드시나요?");
    await waitFor(() => expect(restored).toHaveValue(`${validInput.description} 수정`));
  });

  it("성공하면 초안을 지우고 false 반환 또는 검증 실패면 유지한다", async () => {
    const user = userEvent.setup();
    const storageKey = `${DRAFT_STORAGE_PREFIX}submit`;
    const { rerender } = render(<AnalysisForm draftKey="submit" defaultValues={validInput} onSubmit={vi.fn()} />);
    // 초안 저장이 시작된 뒤에 제출해야 제출 성공 뒤 늦게 저장되는 경우가 없다.
    await waitFor(() => expect(sessionStorage.getItem(storageKey)).not.toBeNull());
    await user.click(screen.getByRole("button", { name: "분석 실행" }));
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    sessionStorage.setItem(storageKey, JSON.stringify({ description: validInput.description, expectedUsers: "under-10k", monthlyBudget: "300,000", region: "canadacentral", availability: "medium" }));
    rerender(<AnalysisForm draftKey="submit" defaultValues={validInput} onSubmit={() => false} />);
    await user.click(screen.getByRole("button", { name: "분석 실행" }));
    expect(sessionStorage.getItem(storageKey)).not.toBeNull();
    await user.clear(screen.getByLabelText("어떤 서비스를 만드시나요?"));
    await user.click(screen.getByRole("button", { name: "분석 실행" }));
    expect(sessionStorage.getItem(storageKey)).not.toBeNull();
  });

  it("워크스페이스 기본 지역과 CAD 칩을 표시한다", () => {
    render(<AnalysisForm defaultRegion="canadacentral" onSubmit={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "지역" })).toHaveValue("canadacentral");
    expect(screen.getByRole("combobox")).toHaveAccessibleDescription("가격과 구성은 이 지역 기준입니다.");
    for (const amount of ["100", "300", "500", "1,000"]) expect(screen.getByRole("button", { name: `CA$${amount}` })).toBeInTheDocument();
  });

  it("횟수 안내 없이 제출 버튼을 항상 제공한다", () => {
    render(<AnalysisForm onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "분석 실행" })).toBeEnabled();
    expect(screen.queryByText(/횟수|차감|Pro|구독/)).not.toBeInTheDocument();
  });

  it("rerun 모드에 원래 결과 링크를 표시한다", () => {
    render(<AnalysisForm mode="rerun" sourceHref="/analyses/abc" onSubmit={vi.fn()} />);
    expect(screen.getByText("조건 바꿔 다시 분석")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "원래 결과 보기" })).toHaveAttribute("href", "/analyses/abc");
  });

  it("draftKey가 없거나 저장이 실패해도 입력 및 제출을 지원하고 잘못된 저장값을 무시한다", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    sessionStorage.clear();
    render(<AnalysisForm defaultValues={validInput} onSubmit={onSubmit} />);
    expect(sessionStorage.length).toBe(0);
    await user.click(screen.getByRole("button", { name: "분석 실행" }));
    expect(onSubmit).toHaveBeenCalledOnce();
    sessionStorage.setItem(`${DRAFT_STORAGE_PREFIX}broken`, "{");
    render(<AnalysisForm draftKey="broken" defaultValues={validInput} onSubmit={vi.fn()} />);
    expect(screen.getAllByLabelText("어떤 서비스를 만드시나요?").at(-1)).toHaveValue(validInput.description);
  });

  it("sessionStorage setItem이 예외를 던져도 입력과 제출이 된다", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    render(<AnalysisForm draftKey="quota" defaultValues={validInput} onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText("어떤 서비스를 만드시나요?"), " 수정");
    await user.click(screen.getByRole("button", { name: "분석 실행" }));
    expect(onSubmit).toHaveBeenCalledOnce();
    setItem.mockRestore();
  });

  it("도움말과 선택지 설명을 연결하고 범위 안내를 서술 도움말에 둔다", () => {
    render(<AnalysisForm onSubmit={vi.fn()} />);
    const description = screen.getByLabelText("어떤 서비스를 만드시나요?");
    const users = screen.getByRole("radiogroup", { name: "예상 사용자 수" });
    const budget = screen.getByLabelText("월 예산");
    expect(description).toHaveAccessibleDescription(/서비스 종류와 주요 기능.*웹앱·API/);
    expect(users).toHaveAccessibleDescription(EXPECTED_USERS_HELP.ko);
    expect(budget).toHaveAccessibleDescription("예산을 넘는 안도 함께 보여 드리고, 안마다 예산 대비 비율을 표시합니다.");
    for (const radio of screen.getAllByRole("radio", { name: /명 이하|명 초과/ })) {
      expect(radio).toHaveAccessibleDescription(EXPECTED_USERS_HELP.ko);
    }
    expect(screen.queryByText("지역은 Korea Central로 고정됩니다.")).not.toBeInTheDocument();
    for (const option of AVAILABILITY_OPTIONS) {
      const radio = screen.getByLabelText(option.label.ko);
      expect(radio).toHaveAccessibleDescription(AVAILABILITY_DESCRIPTIONS[option.value].ko);
    }
  });

  it("빈 서술에 예시 칩을 보이고 선택하면 채우고 글자 수를 갱신한다", async () => {
    const user = userEvent.setup();
    render(<AnalysisForm onSubmit={vi.fn()} />);
    expect(screen.getByRole("group", { name: "예시로 채우기" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "예약 서비스" }));
    expect(screen.getByLabelText("어떤 서비스를 만드시나요?")).toHaveValue("회원 1만 명 규모의 예약 웹 서비스입니다. Next.js 프런트와 Node API, PostgreSQL을 씁니다. 결제는 외부 PG를 쓰고, 주말 저녁에 예약이 몰립니다.");
    expect(screen.queryByRole("group", { name: "예시로 채우기" })).not.toBeInTheDocument();
    expect(screen.getByText(/\/ 2,000$/)).toHaveTextContent("/ 2,000");
    expect(screen.getByLabelText("어떤 서비스를 만드시나요?")).toHaveFocus();
  });

  it("예산을 쉼표로 표시하고 숫자로 제출하며 빠른 예산 칩을 적용한다", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<AnalysisForm defaultValues={{ ...validInput, monthlyBudget: undefined }} onSubmit={onSubmit} />);
    const budget = screen.getByLabelText("월 예산");
    await user.type(budget, "1500000");
    expect(budget).toHaveValue("1,500,000");
    await user.click(screen.getByRole("button", { name: "CA$300" }));
    expect(budget).toHaveValue("300");
    await user.clear(budget);
    await user.type(budget, "1500000");
    await user.click(screen.getByRole("button", { name: "분석 실행" }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ ...validInput, monthlyBudget: 1_500_000 });
  });

  it("예산 중간을 고쳐도 쉼표를 다시 정리한 뒤 커서를 같은 숫자 뒤에 둔다", () => {
    render(<AnalysisForm defaultValues={{ ...validInput, monthlyBudget: 1_500_000 }} onSubmit={vi.fn()} />);
    const budget = screen.getByLabelText<HTMLInputElement>("월 예산");
    fireEvent.change(budget, { target: { value: "1,2500,000", selectionStart: 3, selectionEnd: 3 } });
    expect(budget).toHaveValue("12,500,000");
    expect(budget.selectionStart).toBe(2);
    fireEvent.change(budget, { target: { value: "12,50,000", selectionStart: 5, selectionEnd: 5 } });
    expect(budget).toHaveValue("1,250,000");
    expect(budget.selectionStart).toBe(5);
  });

  it("소수 예산은 바꾸지 않고 정수 오류를 제출 시 표시한다", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<AnalysisForm defaultValues={{ ...validInput, monthlyBudget: undefined }} onSubmit={onSubmit} />);
    const budget = screen.getByLabelText("월 예산");
    await user.type(budget, "12.5");
    expect(budget).toHaveValue("12.5");
    await user.click(screen.getByRole("button", { name: "분석 실행" }));
    expect(screen.getByText("월 예산은 정수로 입력해 주세요.")).toBeInTheDocument();
  });

  it("빈 폼 제출은 네 오류를 표시하고 첫 입력에 포커스한다", async () => {
    const user = userEvent.setup();
    render(<AnalysisForm onSubmit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "분석 실행" }));
    expect(screen.getByText("요구사항은 10자 이상 입력해 주세요.")).toBeInTheDocument();
    expect(screen.getByText("예상 사용자 수를 선택해 주세요.")).toBeInTheDocument();
    expect(screen.getByText("월 예산은 유한한 숫자로 입력해 주세요.")).toBeInTheDocument();
    expect(screen.getByText("가용성 수준을 선택해 주세요.")).toBeInTheDocument();
    expect(screen.getByLabelText("어떤 서비스를 만드시나요?")).toHaveFocus();
  });

  it("서술이 맞으면 예상 사용자 첫 라디오에 포커스하고 오류 필드만 즉시 재검증한다", async () => {
    const user = userEvent.setup();
    render(<AnalysisForm defaultValues={{ description: validInput.description }} onSubmit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "분석 실행" }));
    expect(screen.getByLabelText(EXPECTED_USERS_OPTIONS[0].label.ko)).toHaveFocus();
    expect(screen.getByText("월 예산은 유한한 숫자로 입력해 주세요.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("월 예산"), "150000");
    expect(screen.queryByText("월 예산은 유한한 숫자로 입력해 주세요.")).not.toBeInTheDocument();
    expect(screen.getByText("예상 사용자 수를 선택해 주세요.")).toBeInTheDocument();
  });

  it("입력 중 오류를 보이지 않고, 오류 필드 수정 즉시 해당 오류를 지운다", async () => {
    const user = userEvent.setup();
    render(<AnalysisForm defaultValues={{ ...validInput, description: "예약" }} onSubmit={vi.fn()} />);
    const description = screen.getByLabelText("어떤 서비스를 만드시나요?");
    await user.type(description, " 입력 중입니다");
    expect(screen.queryByText("요구사항은 10자 이상 입력해 주세요.")).not.toBeInTheDocument();
    await user.clear(description);
    await user.click(screen.getByRole("button", { name: "분석 실행" }));
    expect(screen.getByText("요구사항은 10자 이상 입력해 주세요.")).toBeInTheDocument();
    await user.type(description, validInput.description);
    expect(screen.queryByText("요구사항은 10자 이상 입력해 주세요.")).not.toBeInTheDocument();
  });

  it.each(["{Meta>}{Enter}{/Meta}", "{Control>}{Enter}{/Control}"])("서술 단축키 %s로 제출한다", async (keys) => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<AnalysisForm defaultValues={validInput} onSubmit={onSubmit} />);
    const description = screen.getByLabelText("어떤 서비스를 만드시나요?");
    await user.click(description);
    await user.keyboard(keys);
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(validInput);
    expect(screen.getByRole("button", { name: "분석 실행" })).toHaveAttribute("aria-keyshortcuts", "Meta+Enter Control+Enter");
  });

  it("pending이면 모든 입력을 잠그고 요청 상태를 표시하며 진행률은 표시하지 않는다", () => {
    render(<AnalysisForm defaultValues={validInput} onSubmit={vi.fn()} pending />);
    expect(screen.getByRole("status")).toHaveTextContent("요청을 보내는 중입니다.");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByLabelText("월 예산")).toBeDisabled();
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
  });
});


it.each(["en", "ko"] as const)("%s에서 CAD 최소 예산 오류를 번역한다", async (locale) => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<AnalysisForm defaultValues={{ ...validInput, monthlyBudget: 9 }} onSubmit={onSubmit} />, { locale });
  await user.click(screen.getByRole("button", { name: locale === "en" ? "Run analysis" : "분석 실행" }));
  expect(screen.getByText(locale === "en" ? "Enter a monthly budget of at least CA$10." : "월 예산은 CA$10 이상 입력해 주세요.")).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});

it("영어 예시와 검증 오류를 표시하고 알 수 없는 오류 원문을 숨긴다", async () => {
  render(<AnalysisForm onSubmit={vi.fn()} errorMessage="private server detail" />, { locale: "en" });
  expect(screen.queryByText("private server detail")).not.toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Run analysis" }));
  expect(screen.getByText("Enter at least 10 characters for your requirements.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Reservation service" }));
  expect(screen.getByLabelText<HTMLTextAreaElement>("What service are you building?").value).toContain("Next.js");
});

it("언어를 바꿔도 입력을 유지하고 기존 오류와 예시를 현재 언어로 바꾼다", async () => {
  const user = userEvent.setup();
  const form = <AnalysisForm onSubmit={vi.fn()} />;
  const { rerender } = render(<I18nProvider locale="ko">{form}</I18nProvider>);
  await user.type(screen.getByLabelText("어떤 서비스를 만드시나요?"), "short");
  await user.click(screen.getByRole("button", { name: "분석 실행" }));
  expect(screen.getByText("요구사항은 10자 이상 입력해 주세요.")).toBeInTheDocument();
  rerender(<I18nProvider locale="en">{form}</I18nProvider>);
  expect(screen.getByLabelText("What service are you building?")).toHaveValue("short");
  expect(screen.getByText("Enter at least 10 characters for your requirements.")).toBeInTheDocument();
  await user.clear(screen.getByLabelText("What service are you building?"));
  await user.click(screen.getByRole("button", { name: "Internal bulletin board" }));
  expect(screen.getByLabelText<HTMLTextAreaElement>("What service are you building?").value).toContain("300 employees");
});

it("falls back from an unsupported workspace region and can submit", async () => {
  const onSubmit = vi.fn();
  render(<AnalysisForm defaultRegion="canadaeast" defaultValues={{ ...validInput, region: "canadaeast" }} onSubmit={onSubmit} />);
  expect(screen.getByLabelText("지역")).toHaveValue("canadacentral");
  fireEvent.submit(screen.getByRole("button", { name: "분석 실행" }).closest("form")!);
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ region: "canadacentral" })));
});

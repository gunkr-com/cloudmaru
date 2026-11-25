import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

describe("테스트 환경", () => {
  it("JSX 렌더링, 사용자 입력, jest-dom 매처를 함께 지원한다", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(<button onClick={onClick}>확인</button>);

    const button = screen.getByRole("button", { name: "확인" });
    expect(button).toBeInTheDocument();
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

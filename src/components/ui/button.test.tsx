import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";

it("버튼 이름과 클릭을 전달하고 비활성 상태에서는 실행하지 않는다", async () => {
  const user = userEvent.setup();
  const onClick = vi.fn();
  const { rerender } = render(<Button onClick={onClick}>분석 실행</Button>);
  const button = screen.getByRole("button", { name: "분석 실행" });
  await user.click(button);
  expect(onClick).toHaveBeenCalledOnce();
  rerender(<Button onClick={onClick} disabled>분석 실행</Button>);
  expect(button).toBeDisabled();
  await user.click(button);
  expect(onClick).toHaveBeenCalledOnce();
});

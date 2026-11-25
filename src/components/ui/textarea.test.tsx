import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { Textarea } from "@/components/ui/textarea";

it("연결된 라벨과 여러 줄 입력, 비활성화를 지원한다", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<>
    <label htmlFor="description">요구사항</label>
    <Textarea id="description" />
  </>);
  const input = screen.getByLabelText("요구사항");
  await user.type(input, "예약 서비스{Enter}데이터베이스 필요");
  expect(input).toHaveValue("예약 서비스\n데이터베이스 필요");
  rerender(<Textarea aria-label="요구사항" disabled />);
  expect(screen.getByLabelText("요구사항")).toBeDisabled();
});

it("조작 요소 대비를 위한 border-control 테두리를 쓴다", () => {
  render(<Textarea aria-label="요구사항" />);
  const textarea = screen.getByLabelText("요구사항");
  expect(textarea.className).toContain("border-border-control");
  expect(textarea.className).not.toContain("border-hairline");
  expect(textarea.className).not.toContain("border-border-strong");
});

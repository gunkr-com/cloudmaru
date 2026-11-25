import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { Input } from "@/components/ui/input";

it("라벨·오류 연결과 쉼표 입력을 지원한다", async () => {
  const user = userEvent.setup();
  render(<>
    <label htmlFor="budget">월 예산</label>
    <Input id="budget" inputMode="numeric" aria-invalid aria-describedby="budget-error" />
    <p id="budget-error">예산을 확인해 주세요.</p>
  </>);
  const input = screen.getByLabelText("월 예산");
  await user.type(input, "300,000");
  expect(input).toHaveValue("300,000");
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveAccessibleDescription("예산을 확인해 주세요.");
});

it("조작 요소 대비를 위한 border-control 테두리를 쓴다", () => {
  render(<Input aria-label="월 예산" />);
  const input = screen.getByLabelText("월 예산");
  expect(input.className).toContain("border-border-control");
  expect(input.className).not.toContain("border-hairline");
  expect(input.className).not.toContain("border-border-strong");
});

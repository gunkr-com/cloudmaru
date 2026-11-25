import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

it("연결된 라벨과 키보드로 하나를 선택하고 비활성화를 지원한다", async () => {
  const user = userEvent.setup();
  const onValueChange = vi.fn();
  const { rerender } = render(
    <RadioGroup aria-label="가용성 수준" defaultValue="low" onValueChange={onValueChange}>
      <RadioGroupItem id="low" value="low" /><label htmlFor="low">낮음</label>
      <RadioGroupItem id="high" value="high" /><label htmlFor="high">높음</label>
    </RadioGroup>,
  );
  await user.click(screen.getByLabelText("낮음"));
  // Radix가 다음 작업에서 초점을 이동할 때까지 키를 누른 상태로 둔다.
  await user.keyboard("{ArrowRight>}");
  await waitFor(() => expect(screen.getByLabelText("높음")).toBeChecked());
  await user.keyboard("{/ArrowRight}");
  expect(screen.getByLabelText("낮음")).not.toBeChecked();
  expect(onValueChange).toHaveBeenCalledWith("high");
  rerender(<RadioGroup aria-label="가용성 수준" disabled><RadioGroupItem value="low" aria-label="낮음" /></RadioGroup>);
  expect(screen.getByLabelText("낮음")).toBeDisabled();
});

it("라디오 경계에 조작 요소 대비를 위한 border-control을 쓴다", () => {
  render(<RadioGroup aria-label="가용성"><RadioGroupItem value="low" aria-label="낮음" /></RadioGroup>);
  const item = screen.getByLabelText("낮음");
  expect(item.className).toContain("border-border-control");
  expect(item.className).not.toContain("border-hairline");
  expect(item.className).not.toContain("border-border-strong");
});

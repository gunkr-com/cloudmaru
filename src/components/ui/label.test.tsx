import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { Label } from "@/components/ui/label";

it("htmlFor로 입력에 연결되어 라벨을 누르면 입력에 초점을 옮긴다", async () => {
  const user = userEvent.setup();
  render(<>
    <Label htmlFor="service">요구사항</Label>
    <input id="service" />
  </>);
  await user.click(screen.getByText("요구사항"));
  expect(screen.getByLabelText("요구사항")).toHaveFocus();
});

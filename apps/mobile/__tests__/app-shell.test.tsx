import { fireEvent, render } from "@testing-library/react-native";
import { AppShellScreen } from "../src/app-shell/AppShellScreen";

describe("AppShellScreen", () => {
  it("starts on the server-selection state without a browser view", async () => {
    const { getByText, queryByTestId } = await render(
      <AppShellScreen
        locale="en"
        theme="light"
        state={{ kind: "server-selection" }}
      />,
    );

    expect(getByText("Connect to a server")).toBeTruthy();
    expect(
      getByText("Add a self-hosted vaehor server to get started."),
    ).toBeTruthy();
    expect(queryByTestId("product-webview")).toBeNull();
  });

  it.each([
    ["loading", "Loading your servers…"],
    ["offline", "You are offline"],
  ] as const)("renders the %s state", async (kind, message) => {
    const { getByText } = await render(
      <AppShellScreen locale="en" theme="light" state={{ kind }} />,
    );

    expect(getByText(message)).toBeTruthy();
  });

  it("shows a recoverable error and retries when requested", async () => {
    const onRetry = jest.fn();
    const { getByText, getByRole } = await render(
      <AppShellScreen
        locale="en"
        theme="light"
        state={{ kind: "error", message: "The server could not be reached." }}
        onRetry={onRetry}
      />,
    );

    expect(getByText("The server could not be reached.")).toBeTruthy();
    fireEvent.press(getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the selected locale and dark theme deterministically", async () => {
    const { getByText, getByTestId } = await render(
      <AppShellScreen
        locale="zh"
        theme="dark"
        state={{ kind: "server-selection" }}
      />,
    );

    expect(getByText("连接到服务器")).toBeTruthy();
    expect(getByTestId("app-shell").props.style).toEqual(
      expect.objectContaining({ backgroundColor: "#111820" }),
    );
  });
});

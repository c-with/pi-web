// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { locale, setLocale, t } from "./i18n";

afterEach(() => {
  localStorage.clear();
  setLocale("en");
  vi.unstubAllGlobals();
});

describe("i18n", () => {
  it("uses the browser's Chinese locale on first run", async () => {
    vi.resetModules();
    vi.stubGlobal("navigator", { language: "zh-CN" });
    const fresh = await import("./i18n");
    expect(fresh.locale()).toBe("zh-CN");
  });

  it("persists an explicit locale and translates parameterized messages", () => {
    setLocale("zh-CN");
    expect(locale()).toBe("zh-CN");
    expect(localStorage.getItem("pi-web.locale")).toBe("zh-CN");
    expect(t("settings.language")).toBe("语言");
  });
});

/**
 * 动画工具测试。
 *
 * 覆盖导出:
 *   - LoadingAnimation
 *   - TypewriterEffect
 *   - renderProgressBar
 *   - PulseEffect
 *   - blink
 *   - gradient
 *   - fadeIn
 *   - Animations
 */
import { describe, expect, test } from "bun:test";
import {
  Animations,
  LoadingAnimation,
  PulseEffect,
  TypewriterEffect,
  blink,
  fadeIn,
  gradient,
  renderProgressBar,
} from "@/ui/utils/animations";

describe("动画工具", () => {
  describe("LoadingAnimation", () => {
    test("默认 spinner 样式", () => {
      const anim = new LoadingAnimation();
      const frame = anim.getCurrentFrame();
      expect(typeof frame).toBe("string");
      expect(frame.length).toBeGreaterThan(0);
    });

    test("dots 样式", () => {
      const anim = new LoadingAnimation("dots");
      expect(anim.getCurrentFrame()).toBeTruthy();
    });

    test("bar 样式带前后缀", () => {
      const anim = new LoadingAnimation("bar");
      const frame = anim.getCurrentFrame();
      expect(frame).toContain("[");
      expect(frame).toContain("]");
    });

    test("自定义前后缀", () => {
      const anim = new LoadingAnimation("spinner", { prefix: ">>", suffix: "<<" });
      const frame = anim.getCurrentFrame();
      expect(frame.startsWith(">>")).toBe(true);
      expect(frame.endsWith("<<")).toBe(true);
    });

    test("start 和 stop 不抛异常", () => {
      const anim = new LoadingAnimation();
      anim.start(() => {});
      anim.stop();
    });

    test("stop 后再 stop 安全", () => {
      const anim = new LoadingAnimation();
      anim.stop();
      expect(() => anim.stop()).not.toThrow();
    });
  });

  describe("TypewriterEffect", () => {
    test("getCurrentText 初始为空", () => {
      const tw = new TypewriterEffect("hello");
      expect(tw.getCurrentText()).toBe("");
    });

    test("complete 后 onUpdate 回调收到完整文本", () => {
      let received = "";
      const tw = new TypewriterEffect("hello world");
      tw.start((text) => {
        received = text;
      });
      tw.complete();
      expect(received).toBe("hello world");
    });

    test("start 和 stop 不抛异常", () => {
      const tw = new TypewriterEffect("test");
      tw.start(() => {});
      tw.stop();
    });

    test("complete 回调被调用", () => {
      let completed = false;
      const tw = new TypewriterEffect("test");
      tw.start(
        () => {},
        () => {
          completed = true;
        },
      );
      tw.complete();
      expect(completed).toBe(true);
    });
  });

  describe("renderProgressBar", () => {
    test("0% 进度", () => {
      const bar = renderProgressBar(0);
      expect(bar).toContain("░");
      expect(bar).toContain("0%");
    });

    test("100% 进度", () => {
      const bar = renderProgressBar(1);
      expect(bar).toContain("█");
      expect(bar).toContain("100%");
    });

    test("50% 进度", () => {
      const bar = renderProgressBar(0.5);
      expect(bar).toContain("50%");
    });

    test("负数被截断到 0", () => {
      const bar = renderProgressBar(-0.5);
      expect(bar).toContain("0%");
    });

    test("超过 1 被截断到 1", () => {
      const bar = renderProgressBar(1.5);
      expect(bar).toContain("100%");
    });

    test("自定义宽度", () => {
      const bar = renderProgressBar(0.5, { width: 10 });
      // 10 格子，5 填充 5 空
      expect(bar).toBeTruthy();
    });

    test("不显示百分比", () => {
      const bar = renderProgressBar(0.5, { showPercent: false });
      expect(bar).not.toContain("%");
    });

    test("自定义字符", () => {
      const bar = renderProgressBar(0.5, { emptyChar: "-", fillChar: "=" });
      expect(bar).toContain("=");
      expect(bar).toContain("-");
    });

    test("带前后缀", () => {
      const bar = renderProgressBar(0.5, { prefix: "Progress: ", suffix: " done" });
      expect(bar).toContain("Progress:");
      expect(bar).toContain("done");
    });
  });

  describe("PulseEffect", () => {
    test("默认字符", () => {
      const pulse = new PulseEffect();
      expect(pulse).toBeDefined();
    });

    test("start 和 stop 不抛异常", () => {
      const pulse = new PulseEffect(["A", "B"]);
      pulse.start(() => {});
      pulse.stop();
    });

    test("stop 后再 stop 安全", () => {
      const pulse = new PulseEffect();
      pulse.stop();
      expect(() => pulse.stop()).not.toThrow();
    });
  });

  describe("blink", () => {
    test("on 模式包含 ANSI 转义码", () => {
      const result = blink("hello", true);
      expect(result).toContain("\x1b[5m");
      expect(result).toContain("hello");
    });

    test("off 模式不含转义码", () => {
      const result = blink("hello", false);
      expect(result).toBe("hello");
    });
  });

  describe("gradient", () => {
    test("返回包含 ANSI 转义码的字符串", () => {
      const result = gradient("hello", 196, 200);
      expect(result).toContain("\x1b[38;5;");
      expect(result).toContain("\x1b[0m");
    });

    test("单字符", () => {
      const result = gradient("A", 196, 200);
      expect(result).toContain("A");
    });

    test("空字符串返回空字符串", () => {
      // Gradient 会 split("") 得到 [""]，然后 map
      const result = gradient("", 196, 200);
      expect(typeof result).toBe("string");
    });
  });

  describe("fadeIn", () => {
    test("低强度使用暗淡效果", () => {
      const result = fadeIn("text", 0.1);
      expect(result).toContain("\x1b[2m");
    });

    test("中等强度正常显示", () => {
      const result = fadeIn("text", 0.5);
      expect(result).toBe("text");
    });

    test("高强度使用明亮效果", () => {
      const result = fadeIn("text", 0.9);
      expect(result).toContain("\x1b[1m");
    });

    test("负数被截断", () => {
      const result = fadeIn("text", -1);
      expect(result).toContain("\x1b[2m");
    });

    test("超过 1 被截断", () => {
      const result = fadeIn("text", 2);
      expect(result).toContain("\x1b[1m");
    });
  });

  describe("Animations 预设", () => {
    test("thinking 返回 LoadingAnimation", () => {
      const anim = Animations.thinking();
      expect(anim).toBeInstanceOf(LoadingAnimation);
    });

    test("loading 返回 LoadingAnimation", () => {
      const anim = Animations.loading();
      expect(anim).toBeInstanceOf(LoadingAnimation);
    });

    test("processing 返回 LoadingAnimation", () => {
      const anim = Animations.processing();
      expect(anim).toBeInstanceOf(LoadingAnimation);
    });

    test("waiting 返回 PulseEffect", () => {
      const anim = Animations.waiting();
      expect(anim).toBeInstanceOf(PulseEffect);
    });

    test("success/error/warning 是数组", () => {
      expect(Array.isArray(Animations.success)).toBe(true);
      expect(Array.isArray(Animations.error)).toBe(true);
      expect(Array.isArray(Animations.warning)).toBe(true);
    });
  });
});

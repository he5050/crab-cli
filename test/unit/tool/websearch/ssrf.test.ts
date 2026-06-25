/**
 * SSRF 防护测试
 */
import { describe, it, expect } from "bun:test";
import { validateFetchUrl, isPrivateOrReservedIp, sanitizeHeaders } from "@/tool/websearch/webfetch";

describe("SSRF 防护", () => {
  describe("validateFetchUrl", () => {
    it("正常 https URL 通过", () => {
      expect(() => validateFetchUrl("https://example.com")).not.toThrow();
    });

    it("正常 http URL 通过", () => {
      expect(() => validateFetchUrl("http://example.com")).not.toThrow();
    });

    it("file:// 协议被拒绝", () => {
      expect(() => validateFetchUrl("file:///etc/passwd")).toThrow();
    });

    it("ftp:// 协议被拒绝", () => {
      expect(() => validateFetchUrl("ftp://files.example.com")).toThrow();
    });

    it("内网 IP 127.0.0.1 被拒绝", () => {
      expect(() => validateFetchUrl("http://127.0.0.1")).toThrow();
    });

    it("内网 IP 10.0.0.1 被拒绝", () => {
      expect(() => validateFetchUrl("http://10.0.0.1")).toThrow();
    });

    it("内网 IP 172.16.0.1 被拒绝", () => {
      expect(() => validateFetchUrl("http://172.16.0.1")).toThrow();
    });

    it("内网 IP 172.31.255.255 被拒绝", () => {
      expect(() => validateFetchUrl("http://172.31.255.255")).toThrow();
    });

    it("内网 IP 192.168.1.1 被拒绝", () => {
      expect(() => validateFetchUrl("http://192.168.1.1")).toThrow();
    });

    it("云元数据 169.254.169.254 被拒绝", () => {
      expect(() => validateFetchUrl("http://169.254.169.254/latest/meta-data")).toThrow();
    });

    it("回环地址 ::1 被拒绝", () => {
      expect(() => validateFetchUrl("http://[::1]")).toThrow();
      expect(() => validateFetchUrl("http://::1")).toThrow();
    });

    it("无效 URL 抛出异常", () => {
      expect(() => validateFetchUrl("not-a-url")).toThrow();
    });

    it("公网域名通过", () => {
      expect(() => validateFetchUrl("https://www.google.com")).not.toThrow();
      expect(() => validateFetchUrl("https://api.github.com/repos/test")).not.toThrow();
    });
  });

  describe("isPrivateOrReservedIp", () => {
    it("127.0.0.0/8 回环地址", () => {
      expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
      expect(isPrivateOrReservedIp("127.255.255.255")).toBe(true);
    });

    it("10.0.0.0/8 A 类私有", () => {
      expect(isPrivateOrReservedIp("10.0.0.1")).toBe(true);
      expect(isPrivateOrReservedIp("10.255.255.255")).toBe(true);
    });

    it("172.16.0.0/12 B 类私有", () => {
      expect(isPrivateOrReservedIp("172.16.0.1")).toBe(true);
      expect(isPrivateOrReservedIp("172.31.255.255")).toBe(true);
      expect(isPrivateOrReservedIp("172.15.0.1")).toBe(false);
      expect(isPrivateOrReservedIp("172.32.0.1")).toBe(false);
    });

    it("192.168.0.0/16 C 类私有", () => {
      expect(isPrivateOrReservedIp("192.168.0.1")).toBe(true);
      expect(isPrivateOrReservedIp("192.168.255.255")).toBe(true);
      expect(isPrivateOrReservedIp("192.169.0.1")).toBe(false);
    });

    it("169.254.0.0/16 链路本地（含云元数据）", () => {
      expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
      expect(isPrivateOrReservedIp("169.254.1.1")).toBe(true);
    });

    it("0.0.0.0/8 当前网络", () => {
      expect(isPrivateOrReservedIp("0.0.0.0")).toBe(true);
      expect(isPrivateOrReservedIp("0.255.255.255")).toBe(true);
    });

    it("224.0.0.0/4 组播地址", () => {
      expect(isPrivateOrReservedIp("224.0.0.1")).toBe(true);
      expect(isPrivateOrReservedIp("239.255.255.255")).toBe(true);
    });

    it("IPv4 映射的 IPv6 格式", () => {
      expect(isPrivateOrReservedIp("::ffff:127.0.0.1")).toBe(true);
      expect(isPrivateOrReservedIp("::ffff:10.0.0.1")).toBe(true);
      expect(isPrivateOrReservedIp("::ffff:192.168.1.1")).toBe(true);
    });

    it("域名不是 IP 返回 false", () => {
      expect(isPrivateOrReservedIp("example.com")).toBe(false);
      expect(isPrivateOrReservedIp("localhost")).toBe(false);
    });

    it("公网 IP 返回 false", () => {
      expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
      expect(isPrivateOrReservedIp("1.1.1.1")).toBe(false);
      expect(isPrivateOrReservedIp("203.0.113.1")).toBe(false);
    });

    it("无效 IP 格式返回 false", () => {
      expect(isPrivateOrReservedIp("256.1.1.1")).toBe(false);
      expect(isPrivateOrReservedIp("abc")).toBe(false);
    });
  });

  describe("sanitizeHeaders", () => {
    it("过滤 host 头部", () => {
      const result = sanitizeHeaders({ host: "evil.com", "X-Custom": "value" });
      expect(result["host"]).toBeUndefined();
      expect(result["X-Custom"]).toBe("value");
    });

    it("过滤 authorization 头部", () => {
      const result = sanitizeHeaders({ Authorization: "Bearer token" });
      expect(result["authorization"]).toBeUndefined();
      expect(result["Authorization"]).toBeUndefined();
    });

    it("过滤 cookie 头部", () => {
      const result = sanitizeHeaders({ cookie: "session=abc" });
      expect(result["cookie"]).toBeUndefined();
    });

    it("过滤 origin 头部", () => {
      const result = sanitizeHeaders({ origin: "https://evil.com" });
      expect(result["origin"]).toBeUndefined();
    });

    it("过滤 referer 头部", () => {
      const result = sanitizeHeaders({ referer: "https://evil.com" });
      expect(result["referer"]).toBeUndefined();
    });

    it("过滤 proxy-authorization 头部", () => {
      const result = sanitizeHeaders({ "Proxy-Authorization": "Basic xyz" });
      expect(result["proxy-authorization"]).toBeUndefined();
    });

    it("保留安全头部", () => {
      const headers = {
        Accept: "application/json",
        "Content-Type": "text/plain",
        "X-Request-Id": "123",
        "User-Agent": "test",
      };
      const result = sanitizeHeaders(headers);
      expect(result["Accept"]).toBe("application/json");
      expect(result["Content-Type"]).toBe("text/plain");
      expect(result["X-Request-Id"]).toBe("123");
      expect(result["User-Agent"]).toBe("test");
    });

    it("空对象返回空对象", () => {
      expect(sanitizeHeaders({})).toEqual({});
    });

    it("全部敏感头部被过滤", () => {
      const headers = {
        host: "evil",
        authorization: "Bearer x",
        origin: "https://evil.com",
        referer: "https://evil.com",
        cookie: "steal=this",
        "set-cookie": "session=abc",
        connection: "close",
        "content-length": "100",
        "content-encoding": "gzip",
        "transfer-encoding": "chunked",
        "proxy-authorization": "Basic x",
        "proxy-connection": "keep-alive",
      };
      const result = sanitizeHeaders(headers);
      expect(Object.keys(result).length).toBe(0);
    });
  });
});

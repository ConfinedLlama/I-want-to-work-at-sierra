import { describe, expect, it } from "vitest";
import { decodeEntities, extractUrls, htmlToText } from "./html.js";

describe("decodeEntities", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(decodeEntities("A &amp; B &lt;3 &#x27;hi&#39; &#x2F;path")).toBe("A & B <3 'hi' /path");
  });

  it("leaves unknown or invalid entities alone", () => {
    expect(decodeEntities("&bogus; &#x110000; &#0;")).toBe("&bogus; &#x110000; &#0;");
  });
});

describe("htmlToText", () => {
  it("turns paragraphs into lines and strips tags", () => {
    expect(htmlToText("Acme | Engineer | Remote<p>We build <i>things</i>.<p>Apply now")).toBe(
      "Acme | Engineer | Remote\nWe build things.\nApply now",
    );
  });

  it("collapses whitespace and blank runs", () => {
    expect(htmlToText("a   b<p><p><p><p>c\r\n")).toBe("a b\n\nc");
  });
});

describe("extractUrls", () => {
  it("prefers the full href over truncated link text", () => {
    const html =
      '<a href="https:&#x2F;&#x2F;acme.com&#x2F;careers?x=1&amp;y=2" rel="nofollow">https://acme.com/car...</a>';
    expect(extractUrls(html)[0]).toBe("https://acme.com/careers?x=1&y=2");
  });

  it("finds bare urls and drops trailing punctuation", () => {
    expect(extractUrls("See https://acme.com/jobs. Or (https://acme.com/about)!")).toEqual([
      "https://acme.com/jobs",
      "https://acme.com/about",
    ]);
  });

  it("dedupes", () => {
    expect(extractUrls('<a href="https://a.co">https://a.co</a>')).toEqual(["https://a.co"]);
  });
});

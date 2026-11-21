import { describe, expect, it } from "vitest";
import { matchTerms, matchesAny } from "./match.js";

describe("matchTerms", () => {
  it("matches whole words regardless of case", () => {
    expect(matchTerms("Head of Customer Support", ["customer support"])).toEqual([
      "customer support",
    ]);
  });

  it("does not match inside a longer word", () => {
    expect(
      matchTerms("Invoice automation for teams that maintain ledgers", ["voice", "ai"]),
    ).toEqual([]);
  });

  it("matches next to punctuation", () => {
    expect(matchTerms("We do voice, chat and email (AI-first).", ["voice", "ai"])).toEqual([
      "voice",
      "ai",
    ]);
  });

  it("treats hyphens and spaces as interchangeable", () => {
    expect(matchesAny("our contact-center platform", ["contact center"])).toBe(true);
    expect(matchesAny("a conversational   AI team", ["conversational-ai"])).toBe(true);
  });

  it("handles terms with regex metacharacters", () => {
    expect(matchTerms("We write C++ and use Node.js", ["c++", "node.js"])).toEqual([
      "c++",
      "node.js",
    ]);
    expect(matchesAny("nodexjs", ["node.js"])).toBe(false);
  });

  it("returns only the terms that matched, in the order given", () => {
    expect(matchTerms("twilio and zendesk", ["zendesk", "genesys", "twilio"])).toEqual([
      "zendesk",
      "twilio",
    ]);
  });

  it("never matches an empty term or empty text", () => {
    expect(matchTerms("anything", ["", "   "])).toEqual([]);
    expect(matchTerms("", ["voice"])).toEqual([]);
  });
});

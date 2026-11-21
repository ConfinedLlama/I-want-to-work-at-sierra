import type { IcpInput } from "./schema.js";

/** The smallest profile that validates. Tests override just the part they care about. */
export function minimalIcp(overrides: Partial<IcpInput> = {}): IcpInput {
  return {
    name: "Test ICP",
    offer: { product: "Thing", oneLiner: "It does the thing.", valueProps: ["Saves time"] },
    company: { keywords: ["support"] },
    personas: [{ name: "Buyer", seniority: ["vp"], titleKeywords: ["support"] }],
    ...overrides,
  };
}

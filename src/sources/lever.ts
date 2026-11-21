import { z } from "zod";
import { jobBoardSource, toIso } from "./job-board.js";

const Response = z.array(
  z.object({
    text: z.string(),
    hostedUrl: z.string(),
    createdAt: z.number().nullish(),
    categories: z.object({ team: z.string().nullish(), location: z.string().nullish() }).nullish(),
  }),
);

export const leverSource = jobBoardSource({
  info: {
    id: "lever",
    name: "Lever job postings",
    homepage: "https://github.com/lever/postings-api",
    rateLimit: "Public and unauthenticated, no documented limit. One request per company.",
    gives: ["hiring"],
  },
  platform: "lever",
  boardUrl: (slug) => `https://jobs.lever.co/${encodeURIComponent(slug)}`,
  apiUrl: (slug) => `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
  schema: Response,
  postings: (response) =>
    response.map((posting) => ({
      title: posting.text,
      url: posting.hostedUrl,
      team: posting.categories?.team ?? undefined,
      location: posting.categories?.location ?? undefined,
      postedAt: toIso(posting.createdAt),
    })),
});

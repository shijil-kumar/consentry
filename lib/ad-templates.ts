// Proven UGC ad-script structures (the "template gallery"). Placeholders in
// [brackets] — the brand fills them or lets the AI assistant rewrite around
// them. Every template is written to PASS a typical rules check: no health
// claims, no guarantees, no urgency-scam phrasing.
export interface AdTemplate {
  slug: string;
  name: string;
  hook: string;
  body: string;
}

export const AD_TEMPLATES: AdTemplate[] = [
  {
    slug: "problem-solution", name: "Problem → Solution",
    hook: "Okay, real talk —",
    body: "Okay, real talk — [the everyday annoyance your product fixes] used to eat my whole morning. Then I tried [product]. [One specific thing it does well], and honestly the difference shows. If that sounds like your week too, check them out at [site or code].",
  },
  {
    slug: "honest-review", name: "Honest 7-day review",
    hook: "I've been using this for a week, so here's my honest take.",
    body: "I've been using [product] for a week, so here's my honest take. What I liked: [benefit 1] and [benefit 2]. What surprised me: [unexpected detail]. Would I keep it? [Yes, and why in one line]. Link's below if you want to try it yourself.",
  },
  {
    slug: "three-reasons", name: "3 reasons countdown",
    hook: "Three reasons people keep asking me about this —",
    body: "Three reasons people keep asking me about [product]. One: [benefit 1]. Two: [benefit 2]. Three — and this is my favourite — [benefit 3]. That's it, that's the ad. [Call to action].",
  },
  {
    slug: "unboxing", name: "Unboxing first-impression",
    hook: "This just arrived and you're opening it with me.",
    body: "This just arrived and you're opening it with me. First thing I noticed: [packaging or first detail]. Setting it up took [time], and [first-use moment]. Early verdict: [one-line impression]. I'll link it below so you can see for yourself.",
  },
  {
    slug: "founder-story", name: "Founder story",
    hook: "The team behind this started with one simple frustration.",
    body: "The team behind [brand] started with one simple frustration: [the origin problem]. So they built [product] — [what makes the approach different]. I love backing brands that actually solve their own problem. See what they made at [site].",
  },
  {
    slug: "faq", name: "FAQ / objection buster",
    hook: "You asked, I'm answering.",
    body: "You asked, I'm answering. 'Is [product] worth it?' — [honest one-line answer]. 'Does it work for [common situation]?' — [answer]. 'What about [common objection]?' — [answer]. Still curious? Everything's at [site or code].",
  },
];

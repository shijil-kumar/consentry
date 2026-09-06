// The Verified Actor Library — platform-recruited, consent-verified actors
// offered at flat per-video prices WITH royalties on every use (unlike the
// anonymous flat-fee stock actors on Arcads/MakeUGC). Curated data for the
// demo; moves to the database when real actor onboarding starts.
export interface LibraryActor {
  slug: string;
  name: string;
  persona: string;
  categories: string[];
  languages: string[];
  pricePaise: number;
  portrait: string; // /actors/*.jpg
  mappedHandle: string; // demo: routes to this seeded creator's live listing
}

export const ACTOR_LIBRARY: LibraryActor[] = [
  {
    slug: "riya", name: "Riya K.", persona: "Warm beauty & lifestyle voice — the trusted friend recommendation",
    categories: ["beauty", "home"], languages: ["English", "Hindi"],
    pricePaise: 149900, portrait: "/actors/a1.jpg", mappedHandle: "aisha",
  },
  {
    slug: "dev", name: "Dev M.", persona: "Fast-talking tech reviewer energy for gadget and app ads",
    categories: ["tech", "gaming"], languages: ["English", "Hindi"],
    pricePaise: 129900, portrait: "/actors/a2.jpg", mappedHandle: "vikram",
  },
  {
    slug: "ananya", name: "Ananya S.", persona: "Calm, premium wellness tone — spa-grade brand storytelling",
    categories: ["wellness", "travel"], languages: ["English", "Malayalam"],
    pricePaise: 199900, portrait: "/actors/a3.jpg", mappedHandle: "meera",
  },
  {
    slug: "arjun", name: "Arjun T.", persona: "No-hype gearhead — autos, tools and gadgets with authority",
    categories: ["auto", "tech"], languages: ["English", "Hindi"],
    pricePaise: 129900, portrait: "/actors/a4.jpg", mappedHandle: "arjun",
  },
  {
    slug: "priya", name: "Priya D.", persona: "High-energy fitness motivator — supplements, apparel, apps",
    categories: ["fitness", "wellness"], languages: ["English", "Tamil"],
    pricePaise: 149900, portrait: "/actors/a5.jpg", mappedHandle: "arjun",
  },
  {
    slug: "rohit", name: "Rohit B.", persona: "Cheerful home-cook charm for food, kitchen and grocery brands",
    categories: ["food", "home"], languages: ["English", "Hindi", "Bengali"],
    pricePaise: 99900, portrait: "/actors/a6.jpg", mappedHandle: "divya",
  },
];

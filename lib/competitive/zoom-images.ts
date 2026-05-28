// Zoom Reveal — curated image set.
//
// Each entry is a freely-licensed image (Wikimedia Commons) plus the canonical
// answer and a list of acceptable aliases for fuzzy matching (via the shared
// Levenshtein matcher in lib/party/levenshtein.ts). The image starts heavily
// blurred/scaled and un-resolves over ~15 seconds; an earlier correct guess
// scores more. A wrong guess locks the player out for the round.
//
// URLs use the Wikimedia Special:FilePath redirect form, which is stable and
// returns the current file bytes. We request a width-bounded thumbnail so the
// payload stays small. Categories: landmarks, animals, art, flags.
//
// NOTE: these are hotlinked from upload.wikimedia.org thumbnails. If a specific
// asset 404s, the client falls back to a "image unavailable, skip round" state
// rather than crashing the match (see the zoom screen component).

export interface ZoomImage {
  id: string;
  url: string;
  answer: string;
  aliases: string[];
  category: "landmark" | "animal" | "art" | "flag";
}

const THUMB = (file: string, w = 800) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${w}`;

export const ZOOM_IMAGES: ZoomImage[] = [
  { id: "eiffel", url: THUMB("Tour_Eiffel_Wikimedia_Commons.jpg"), answer: "Eiffel Tower", aliases: ["eiffel", "la tour eiffel", "the eiffel tower"], category: "landmark" },
  { id: "colosseum", url: THUMB("Colosseo_2020.jpg"), answer: "Colosseum", aliases: ["the colosseum", "roman colosseum", "coliseum"], category: "landmark" },
  { id: "tajmahal", url: THUMB("Taj_Mahal_(Edited).jpeg"), answer: "Taj Mahal", aliases: ["the taj mahal", "taj"], category: "landmark" },
  { id: "bigben", url: THUMB("Clock_Tower_-_Palace_of_Westminster,_London_-_May_2007.jpg"), answer: "Big Ben", aliases: ["big ben", "elizabeth tower", "westminster clock"], category: "landmark" },
  { id: "pisa", url: THUMB("The_Leaning_Tower_of_Pisa_SB.jpeg"), answer: "Leaning Tower of Pisa", aliases: ["leaning tower of pisa", "tower of pisa", "pisa"], category: "landmark" },
  { id: "sydney", url: THUMB("Sydney_Opera_House_Sails_edit02.jpg"), answer: "Sydney Opera House", aliases: ["opera house", "sydney opera"], category: "landmark" },
  { id: "statue", url: THUMB("Statue_of_Liberty_7.jpg"), answer: "Statue of Liberty", aliases: ["statue of liberty", "lady liberty"], category: "landmark" },
  { id: "christ", url: THUMB("Christ_on_Corcovado_mountain.JPG"), answer: "Christ the Redeemer", aliases: ["christ the redeemer", "cristo redentor"], category: "landmark" },
  { id: "machu", url: THUMB("Machu_Picchu,_Peru.jpg"), answer: "Machu Picchu", aliases: ["machu picchu", "machu pichu"], category: "landmark" },
  { id: "pyramids", url: THUMB("Kheops-Pyramid.jpg"), answer: "Great Pyramid of Giza", aliases: ["pyramids of giza", "great pyramid", "giza", "egyptian pyramids"], category: "landmark" },

  { id: "panda", url: THUMB("Grosser_Panda.JPG"), answer: "Giant Panda", aliases: ["panda", "giant panda"], category: "animal" },
  { id: "tiger", url: THUMB("Walking_tiger_female.jpg"), answer: "Tiger", aliases: ["bengal tiger", "tiger"], category: "animal" },
  { id: "elephant", url: THUMB("African_Bush_Elephant.jpg"), answer: "Elephant", aliases: ["african elephant", "elephant"], category: "animal" },
  { id: "penguin", url: THUMB("Manchot_01.jpg"), answer: "Penguin", aliases: ["penguin", "emperor penguin"], category: "animal" },
  { id: "giraffe", url: THUMB("Giraffe_Mikumi_National_Park.jpg"), answer: "Giraffe", aliases: ["giraffe"], category: "animal" },
  { id: "owl", url: THUMB("Bubo_virginianus_06.jpg"), answer: "Owl", aliases: ["owl", "great horned owl"], category: "animal" },
  { id: "flamingo", url: THUMB("Phoenicopterus_ruber_in_S%C3%A3o_Paulo_Zoo.jpg"), answer: "Flamingo", aliases: ["flamingo"], category: "animal" },
  { id: "octopus", url: THUMB("Octopus_vulgaris_2.jpg"), answer: "Octopus", aliases: ["octopus"], category: "animal" },

  { id: "monalisa", url: THUMB("Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg"), answer: "Mona Lisa", aliases: ["mona lisa", "la gioconda"], category: "art" },
  { id: "starrynight", url: THUMB("Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg"), answer: "The Starry Night", aliases: ["starry night", "the starry night"], category: "art" },
  { id: "scream", url: THUMB("Edvard_Munch,_1893,_The_Scream,_oil,_tempera_and_pastel_on_cardboard,_91_x_73_cm,_National_Gallery_of_Norway.jpg"), answer: "The Scream", aliases: ["the scream", "scream"], category: "art" },
  { id: "pearl", url: THUMB("1665_Girl_with_a_Pearl_Earring.jpg"), answer: "Girl with a Pearl Earring", aliases: ["girl with a pearl earring", "pearl earring"], category: "art" },

  { id: "flag_japan", url: THUMB("Flag_of_Japan.svg"), answer: "Japan", aliases: ["japanese flag", "japan"], category: "flag" },
  { id: "flag_brazil", url: THUMB("Flag_of_Brazil.svg"), answer: "Brazil", aliases: ["brazilian flag", "brazil"], category: "flag" },
  { id: "flag_canada", url: THUMB("Flag_of_Canada_(Pantone).svg"), answer: "Canada", aliases: ["canadian flag", "canada"], category: "flag" },
];

export function pickZoomImages(n: number): ZoomImage[] {
  const shuffled = [...ZOOM_IMAGES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, shuffled.length));
}

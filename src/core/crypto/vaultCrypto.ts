/**
 * vaultCrypto.ts
 * ---------------------------------------------------------------------------
 * Motor criptográfico de Conocimiento Cero (Zero-Knowledge) para la bóveda.
 *
 * Principios de diseño:
 * - Toda operación criptográfica ocurre EXCLUSIVAMENTE en el cliente mediante
 *   la Web Crypto API nativa (`SubtleCrypto` + `Crypto.getRandomValues`).
 * - El servidor nunca recibe la passphrase, la clave derivada, ni texto plano.
 *   Únicamente persiste blobs cifrados (AES-GCM-256), su IV y metadatos.
 * - La clave derivada (`CryptoKey`) se genera como NO extraíble
 *   (`extractable = false`), de modo que ni siquiera el propio proceso en el
 *   que corre la aplicación puede exportar el material bruto de la clave.
 * - Cero dependencias externas: no se utiliza ninguna librería de terceros
 *   para criptografía, únicamente APIs nativas del navegador.
 *
 * NO usar este módulo en un contexto sin `window.crypto.subtle` disponible
 * (por ejemplo, contextos no seguros / no HTTPS, o entornos sin soporte).
 * ---------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// Constantes de configuración criptográfica
// ---------------------------------------------------------------------------

/** Número de iteraciones PBKDF2. 100,000 es el mínimo recomendado por OWASP. */
const PBKDF2_ITERATIONS = 100_000;

/** Algoritmo hash utilizado tanto por PBKDF2 como por el fingerprint SHA-256. */
const HASH_ALGORITHM = "SHA-256";

/** Longitud de la clave simétrica derivada, en bits (AES-256). */
const AES_KEY_LENGTH_BITS = 256;

/** Longitud recomendada del IV para AES-GCM, en bytes (96 bits). */
const IV_LENGTH_BYTES = 12;

/** Cantidad de palabras que compone una frase de recuperación. */
const RECOVERY_PHRASE_WORD_COUNT = 12;

/** Máscara de 11 bits (0-2047): el diccionario BIP-39 tiene exactamente 2048 palabras. */
const ELEVEN_BIT_MASK = 0x07ff;

// ---------------------------------------------------------------------------
// Utilidades de conversión ArrayBuffer <-> Hex / Base64
// ---------------------------------------------------------------------------
// Se exponen como utilidades reutilizables del módulo (por ejemplo, para
// serializar IVs, hashes o blobs cifrados al persistirlos en Supabase/JSON),
// implementadas de forma segura y sin dependencias externas.

/**
 * Convierte un ArrayBuffer a una cadena hexadecimal en minúsculas.
 */
export function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Convierte una cadena hexadecimal a un ArrayBuffer.
 * Lanza un error si la cadena no tiene una longitud par o contiene
 * caracteres no hexadecimales.
 */
export function hexToBuffer(hex: string): ArrayBuffer {
  if (hex.length === 0 || hex.length % 2 !== 0) {
    throw new Error(
      "hexToBuffer: la cadena hexadecimal debe tener longitud par y no estar vacía.",
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error("hexToBuffer: la cadena contiene caracteres no hexadecimales.");
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    const byteHex = hex.substring(i * 2, i * 2 + 2);
    bytes[i] = Number.parseInt(byteHex, 16);
  }
  return bytes.buffer;
}

/**
 * Convierte un ArrayBuffer a una cadena Base64 (RFC 4648).
 * Procesa el buffer en bloques para evitar desbordar la pila de llamadas
 * en buffers grandes al usar `String.fromCharCode`.
 */
export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 0x8000; // 32 KB por bloque
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }

  return window.btoa(binary);
}

/**
 * Convierte una cadena Base64 a un ArrayBuffer.
 */
export function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

// ---------------------------------------------------------------------------
// Derivación de clave (PBKDF2 -> AES-GCM-256)
// ---------------------------------------------------------------------------

/**
 * Deriva una clave simétrica de 256 bits apta para AES-GCM a partir de una
 * passphrase y un salt, utilizando PBKDF2 con hash SHA-256 y 100,000
 * iteraciones.
 *
 * La `CryptoKey` resultante es NO extraíble: no puede exportarse su material
 * bruto fuera del motor criptográfico del navegador, reforzando el modelo de
 * Conocimiento Cero.
 *
 * @param passphrase Frase secreta del usuario (nunca se envía al servidor).
 * @param salt       Sal aleatoria única por bóveda (puede almacenarse en claro).
 */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  if (passphrase.length === 0) {
    throw new Error("deriveKey: la passphrase no puede estar vacía.");
  }
  if (salt.length === 0) {
    throw new Error("deriveKey: el salt no puede estar vacío.");
  }

  const encoder = new TextEncoder();

  const baseKeyMaterial = await window.crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: HASH_ALGORITHM,
    },
    baseKeyMaterial,
    { name: "AES-GCM", length: AES_KEY_LENGTH_BITS },
    false, // no extractable: refuerza el modelo Zero-Knowledge
    ["encrypt", "decrypt"],
  );
}

// ---------------------------------------------------------------------------
// Cifrado / Descifrado simétrico (AES-GCM-256)
// ---------------------------------------------------------------------------

/**
 * Cifra un ArrayBuffer con AES-GCM-256 usando la clave provista.
 * Genera internamente un IV aleatorio de 12 bytes (96 bits), único por
 * operación, tal como exige el estándar AES-GCM.
 *
 * @returns El binario cifrado y el IV codificado en hexadecimal.
 */
export async function encryptBuffer(
  data: ArrayBuffer,
  key: CryptoKey,
): Promise<{ cipherBuffer: ArrayBuffer; iv: string }> {
  const ivBytes = new Uint8Array(IV_LENGTH_BYTES);
  window.crypto.getRandomValues(ivBytes);

  const cipherBuffer = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ivBytes },
    key,
    data,
  );

  return {
    cipherBuffer,
    iv: bufferToHex(ivBytes.buffer),
  };
}

/**
 * Descifra un ArrayBuffer previamente cifrado con `encryptBuffer`, usando la
 * misma clave y el IV (en hexadecimal) generado durante el cifrado.
 *
 * Si la clave, el IV o el ciphertext no coinciden (integridad comprometida),
 * `SubtleCrypto` rechaza la promesa automáticamente gracias al tag de
 * autenticación de AES-GCM.
 */
export async function decryptBuffer(
  cipherBuffer: ArrayBuffer,
  key: CryptoKey,
  ivString: string,
): Promise<ArrayBuffer> {
  const ivBuffer = hexToBuffer(ivString);

  if (ivBuffer.byteLength !== IV_LENGTH_BYTES) {
    throw new Error(
      `decryptBuffer: longitud de IV inválida. Se esperaban ${IV_LENGTH_BYTES} bytes.`,
    );
  }

  return window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(ivBuffer) },
    key,
    cipherBuffer,
  );
}

// ---------------------------------------------------------------------------
// Huella digital (SHA-256)
// ---------------------------------------------------------------------------

/**
 * Calcula la huella digital SHA-256 de un ArrayBuffer en texto claro.
 * Útil para verificar integridad de archivos antes/después de cifrar.
 *
 * @returns Hash en formato hexadecimal, en minúsculas.
 */
export async function computeSHA256(data: ArrayBuffer): Promise<string> {
  const digest = await window.crypto.subtle.digest(HASH_ALGORITHM, data);
  return bufferToHex(digest);
}

// ---------------------------------------------------------------------------
// Frase de recuperación (diccionario mnemónico BIP-39, inglés)
// ---------------------------------------------------------------------------

/**
 * Diccionario oficial BIP-39 en inglés (2048 palabras).
 * Fuente: https://github.com/bitcoin/bips/blob/master/bip-0039/english.txt
 */
const BIP39_ENGLISH_WORDLIST: readonly string[] = [
  "abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract", "absurd", "abuse",
  "access", "accident", "account", "accuse", "achieve", "acid", "acoustic", "acquire", "across", "act",
  "action", "actor", "actress", "actual", "adapt", "add", "addict", "address", "adjust", "admit",
  "adult", "advance", "advice", "aerobic", "affair", "afford", "afraid", "again", "age", "agent",
  "agree", "ahead", "aim", "air", "airport", "aisle", "alarm", "album", "alcohol", "alert",
  "alien", "all", "alley", "allow", "almost", "alone", "alpha", "already", "also", "alter",
  "always", "amateur", "amazing", "among", "amount", "amused", "analyst", "anchor", "ancient", "anger",
  "angle", "angry", "animal", "ankle", "announce", "annual", "another", "answer", "antenna", "antique",
  "anxiety", "any", "apart", "apology", "appear", "apple", "approve", "april", "arch", "arctic",
  "area", "arena", "argue", "arm", "armed", "armor", "army", "around", "arrange", "arrest",
  "arrive", "arrow", "art", "artefact", "artist", "artwork", "ask", "aspect", "assault", "asset",
  "assist", "assume", "asthma", "athlete", "atom", "attack", "attend", "attitude", "attract", "auction",
  "audit", "august", "aunt", "author", "auto", "autumn", "average", "avocado", "avoid", "awake",
  "aware", "away", "awesome", "awful", "awkward", "axis", "baby", "bachelor", "bacon", "badge",
  "bag", "balance", "balcony", "ball", "bamboo", "banana", "banner", "bar", "barely", "bargain",
  "barrel", "base", "basic", "basket", "battle", "beach", "bean", "beauty", "because", "become",
  "beef", "before", "begin", "behave", "behind", "believe", "below", "belt", "bench", "benefit",
  "best", "betray", "better", "between", "beyond", "bicycle", "bid", "bike", "bind", "biology",
  "bird", "birth", "bitter", "black", "blade", "blame", "blanket", "blast", "bleak", "bless",
  "blind", "blood", "blossom", "blouse", "blue", "blur", "blush", "board", "boat", "body",
  "boil", "bomb", "bone", "bonus", "book", "boost", "border", "boring", "borrow", "boss",
  "bottom", "bounce", "box", "boy", "bracket", "brain", "brand", "brass", "brave", "bread",
  "breeze", "brick", "bridge", "brief", "bright", "bring", "brisk", "broccoli", "broken", "bronze",
  "broom", "brother", "brown", "brush", "bubble", "buddy", "budget", "buffalo", "build", "bulb",
  "bulk", "bullet", "bundle", "bunker", "burden", "burger", "burst", "bus", "business", "busy",
  "butter", "buyer", "buzz", "cabbage", "cabin", "cable", "cactus", "cage", "cake", "call",
  "calm", "camera", "camp", "can", "canal", "cancel", "candy", "cannon", "canoe", "canvas",
  "canyon", "capable", "capital", "captain", "car", "carbon", "card", "cargo", "carpet", "carry",
  "cart", "case", "cash", "casino", "castle", "casual", "cat", "catalog", "catch", "category",
  "cattle", "caught", "cause", "caution", "cave", "ceiling", "celery", "cement", "census", "century",
  "cereal", "certain", "chair", "chalk", "champion", "change", "chaos", "chapter", "charge", "chase",
  "chat", "cheap", "check", "cheese", "chef", "cherry", "chest", "chicken", "chief", "child",
  "chimney", "choice", "choose", "chronic", "chuckle", "chunk", "churn", "cigar", "cinnamon", "circle",
  "citizen", "city", "civil", "claim", "clap", "clarify", "claw", "clay", "clean", "clerk",
  "clever", "click", "client", "cliff", "climb", "clinic", "clip", "clock", "clog", "close",
  "cloth", "cloud", "clown", "club", "clump", "cluster", "clutch", "coach", "coast", "coconut",
  "code", "coffee", "coil", "coin", "collect", "color", "column", "combine", "come", "comfort",
  "comic", "common", "company", "concert", "conduct", "confirm", "congress", "connect", "consider", "control",
  "convince", "cook", "cool", "copper", "copy", "coral", "core", "corn", "correct", "cost",
  "cotton", "couch", "country", "couple", "course", "cousin", "cover", "coyote", "crack", "cradle",
  "craft", "cram", "crane", "crash", "crater", "crawl", "crazy", "cream", "credit", "creek",
  "crew", "cricket", "crime", "crisp", "critic", "crop", "cross", "crouch", "crowd", "crucial",
  "cruel", "cruise", "crumble", "crunch", "crush", "cry", "crystal", "cube", "culture", "cup",
  "cupboard", "curious", "current", "curtain", "curve", "cushion", "custom", "cute", "cycle", "dad",
  "damage", "damp", "dance", "danger", "daring", "dash", "daughter", "dawn", "day", "deal",
  "debate", "debris", "decade", "december", "decide", "decline", "decorate", "decrease", "deer", "defense",
  "define", "defy", "degree", "delay", "deliver", "demand", "demise", "denial", "dentist", "deny",
  "depart", "depend", "deposit", "depth", "deputy", "derive", "describe", "desert", "design", "desk",
  "despair", "destroy", "detail", "detect", "develop", "device", "devote", "diagram", "dial", "diamond",
  "diary", "dice", "diesel", "diet", "differ", "digital", "dignity", "dilemma", "dinner", "dinosaur",
  "direct", "dirt", "disagree", "discover", "disease", "dish", "dismiss", "disorder", "display", "distance",
  "divert", "divide", "divorce", "dizzy", "doctor", "document", "dog", "doll", "dolphin", "domain",
  "donate", "donkey", "donor", "door", "dose", "double", "dove", "draft", "dragon", "drama",
  "drastic", "draw", "dream", "dress", "drift", "drill", "drink", "drip", "drive", "drop",
  "drum", "dry", "duck", "dumb", "dune", "during", "dust", "dutch", "duty", "dwarf",
  "dynamic", "eager", "eagle", "early", "earn", "earth", "easily", "east", "easy", "echo",
  "ecology", "economy", "edge", "edit", "educate", "effort", "egg", "eight", "either", "elbow",
  "elder", "electric", "elegant", "element", "elephant", "elevator", "elite", "else", "embark", "embody",
  "embrace", "emerge", "emotion", "employ", "empower", "empty", "enable", "enact", "end", "endless",
  "endorse", "enemy", "energy", "enforce", "engage", "engine", "enhance", "enjoy", "enlist", "enough",
  "enrich", "enroll", "ensure", "enter", "entire", "entry", "envelope", "episode", "equal", "equip",
  "era", "erase", "erode", "erosion", "error", "erupt", "escape", "essay", "essence", "estate",
  "eternal", "ethics", "evidence", "evil", "evoke", "evolve", "exact", "example", "excess", "exchange",
  "excite", "exclude", "excuse", "execute", "exercise", "exhaust", "exhibit", "exile", "exist", "exit",
  "exotic", "expand", "expect", "expire", "explain", "expose", "express", "extend", "extra", "eye",
  "eyebrow", "fabric", "face", "faculty", "fade", "faint", "faith", "fall", "false", "fame",
  "family", "famous", "fan", "fancy", "fantasy", "farm", "fashion", "fat", "fatal", "father",
  "fatigue", "fault", "favorite", "feature", "february", "federal", "fee", "feed", "feel", "female",
  "fence", "festival", "fetch", "fever", "few", "fiber", "fiction", "field", "figure", "file",
  "film", "filter", "final", "find", "fine", "finger", "finish", "fire", "firm", "first",
  "fiscal", "fish", "fit", "fitness", "fix", "flag", "flame", "flash", "flat", "flavor",
  "flee", "flight", "flip", "float", "flock", "floor", "flower", "fluid", "flush", "fly",
  "foam", "focus", "fog", "foil", "fold", "follow", "food", "foot", "force", "forest",
  "forget", "fork", "fortune", "forum", "forward", "fossil", "foster", "found", "fox", "fragile",
  "frame", "frequent", "fresh", "friend", "fringe", "frog", "front", "frost", "frown", "frozen",
  "fruit", "fuel", "fun", "funny", "furnace", "fury", "future", "gadget", "gain", "galaxy",
  "gallery", "game", "gap", "garage", "garbage", "garden", "garlic", "garment", "gas", "gasp",
  "gate", "gather", "gauge", "gaze", "general", "genius", "genre", "gentle", "genuine", "gesture",
  "ghost", "giant", "gift", "giggle", "ginger", "giraffe", "girl", "give", "glad", "glance",
  "glare", "glass", "glide", "glimpse", "globe", "gloom", "glory", "glove", "glow", "glue",
  "goat", "goddess", "gold", "good", "goose", "gorilla", "gospel", "gossip", "govern", "gown",
  "grab", "grace", "grain", "grant", "grape", "grass", "gravity", "great", "green", "grid",
  "grief", "grit", "grocery", "group", "grow", "grunt", "guard", "guess", "guide", "guilt",
  "guitar", "gun", "gym", "habit", "hair", "half", "hammer", "hamster", "hand", "happy",
  "harbor", "hard", "harsh", "harvest", "hat", "have", "hawk", "hazard", "head", "health",
  "heart", "heavy", "hedgehog", "height", "hello", "helmet", "help", "hen", "hero", "hidden",
  "high", "hill", "hint", "hip", "hire", "history", "hobby", "hockey", "hold", "hole",
  "holiday", "hollow", "home", "honey", "hood", "hope", "horn", "horror", "horse", "hospital",
  "host", "hotel", "hour", "hover", "hub", "huge", "human", "humble", "humor", "hundred",
  "hungry", "hunt", "hurdle", "hurry", "hurt", "husband", "hybrid", "ice", "icon", "idea",
  "identify", "idle", "ignore", "ill", "illegal", "illness", "image", "imitate", "immense", "immune",
  "impact", "impose", "improve", "impulse", "inch", "include", "income", "increase", "index", "indicate",
  "indoor", "industry", "infant", "inflict", "inform", "inhale", "inherit", "initial", "inject", "injury",
  "inmate", "inner", "innocent", "input", "inquiry", "insane", "insect", "inside", "inspire", "install",
  "intact", "interest", "into", "invest", "invite", "involve", "iron", "island", "isolate", "issue",
  "item", "ivory", "jacket", "jaguar", "jar", "jazz", "jealous", "jeans", "jelly", "jewel",
  "job", "join", "joke", "journey", "joy", "judge", "juice", "jump", "jungle", "junior",
  "junk", "just", "kangaroo", "keen", "keep", "ketchup", "key", "kick", "kid", "kidney",
  "kind", "kingdom", "kiss", "kit", "kitchen", "kite", "kitten", "kiwi", "knee", "knife",
  "knock", "know", "lab", "label", "labor", "ladder", "lady", "lake", "lamp", "language",
  "laptop", "large", "later", "latin", "laugh", "laundry", "lava", "law", "lawn", "lawsuit",
  "layer", "lazy", "leader", "leaf", "learn", "leave", "lecture", "left", "leg", "legal",
  "legend", "leisure", "lemon", "lend", "length", "lens", "leopard", "lesson", "letter", "level",
  "liar", "liberty", "library", "license", "life", "lift", "light", "like", "limb", "limit",
  "link", "lion", "liquid", "list", "little", "live", "lizard", "load", "loan", "lobster",
  "local", "lock", "logic", "lonely", "long", "loop", "lottery", "loud", "lounge", "love",
  "loyal", "lucky", "luggage", "lumber", "lunar", "lunch", "luxury", "lyrics", "machine", "mad",
  "magic", "magnet", "maid", "mail", "main", "major", "make", "mammal", "man", "manage",
  "mandate", "mango", "mansion", "manual", "maple", "marble", "march", "margin", "marine", "market",
  "marriage", "mask", "mass", "master", "match", "material", "math", "matrix", "matter", "maximum",
  "maze", "meadow", "mean", "measure", "meat", "mechanic", "medal", "media", "melody", "melt",
  "member", "memory", "mention", "menu", "mercy", "merge", "merit", "merry", "mesh", "message",
  "metal", "method", "middle", "midnight", "milk", "million", "mimic", "mind", "minimum", "minor",
  "minute", "miracle", "mirror", "misery", "miss", "mistake", "mix", "mixed", "mixture", "mobile",
  "model", "modify", "mom", "moment", "monitor", "monkey", "monster", "month", "moon", "moral",
  "more", "morning", "mosquito", "mother", "motion", "motor", "mountain", "mouse", "move", "movie",
  "much", "muffin", "mule", "multiply", "muscle", "museum", "mushroom", "music", "must", "mutual",
  "myself", "mystery", "myth", "naive", "name", "napkin", "narrow", "nasty", "nation", "nature",
  "near", "neck", "need", "negative", "neglect", "neither", "nephew", "nerve", "nest", "net",
  "network", "neutral", "never", "news", "next", "nice", "night", "noble", "noise", "nominee",
  "noodle", "normal", "north", "nose", "notable", "note", "nothing", "notice", "novel", "now",
  "nuclear", "number", "nurse", "nut", "oak", "obey", "object", "oblige", "obscure", "observe",
  "obtain", "obvious", "occur", "ocean", "october", "odor", "off", "offer", "office", "often",
  "oil", "okay", "old", "olive", "olympic", "omit", "once", "one", "onion", "online",
  "only", "open", "opera", "opinion", "oppose", "option", "orange", "orbit", "orchard", "order",
  "ordinary", "organ", "orient", "original", "orphan", "ostrich", "other", "outdoor", "outer", "output",
  "outside", "oval", "oven", "over", "own", "owner", "oxygen", "oyster", "ozone", "pact",
  "paddle", "page", "pair", "palace", "palm", "panda", "panel", "panic", "panther", "paper",
  "parade", "parent", "park", "parrot", "party", "pass", "patch", "path", "patient", "patrol",
  "pattern", "pause", "pave", "payment", "peace", "peanut", "pear", "peasant", "pelican", "pen",
  "penalty", "pencil", "people", "pepper", "perfect", "permit", "person", "pet", "phone", "photo",
  "phrase", "physical", "piano", "picnic", "picture", "piece", "pig", "pigeon", "pill", "pilot",
  "pink", "pioneer", "pipe", "pistol", "pitch", "pizza", "place", "planet", "plastic", "plate",
  "play", "please", "pledge", "pluck", "plug", "plunge", "poem", "poet", "point", "polar",
  "pole", "police", "pond", "pony", "pool", "popular", "portion", "position", "possible", "post",
  "potato", "pottery", "poverty", "powder", "power", "practice", "praise", "predict", "prefer", "prepare",
  "present", "pretty", "prevent", "price", "pride", "primary", "print", "priority", "prison", "private",
  "prize", "problem", "process", "produce", "profit", "program", "project", "promote", "proof", "property",
  "prosper", "protect", "proud", "provide", "public", "pudding", "pull", "pulp", "pulse", "pumpkin",
  "punch", "pupil", "puppy", "purchase", "purity", "purpose", "purse", "push", "put", "puzzle",
  "pyramid", "quality", "quantum", "quarter", "question", "quick", "quit", "quiz", "quote", "rabbit",
  "raccoon", "race", "rack", "radar", "radio", "rail", "rain", "raise", "rally", "ramp",
  "ranch", "random", "range", "rapid", "rare", "rate", "rather", "raven", "raw", "razor",
  "ready", "real", "reason", "rebel", "rebuild", "recall", "receive", "recipe", "record", "recycle",
  "reduce", "reflect", "reform", "refuse", "region", "regret", "regular", "reject", "relax", "release",
  "relief", "rely", "remain", "remember", "remind", "remove", "render", "renew", "rent", "reopen",
  "repair", "repeat", "replace", "report", "require", "rescue", "resemble", "resist", "resource", "response",
  "result", "retire", "retreat", "return", "reunion", "reveal", "review", "reward", "rhythm", "rib",
  "ribbon", "rice", "rich", "ride", "ridge", "rifle", "right", "rigid", "ring", "riot",
  "ripple", "risk", "ritual", "rival", "river", "road", "roast", "robot", "robust", "rocket",
  "romance", "roof", "rookie", "room", "rose", "rotate", "rough", "round", "route", "royal",
  "rubber", "rude", "rug", "rule", "run", "runway", "rural", "sad", "saddle", "sadness",
  "safe", "sail", "salad", "salmon", "salon", "salt", "salute", "same", "sample", "sand",
  "satisfy", "satoshi", "sauce", "sausage", "save", "say", "scale", "scan", "scare", "scatter",
  "scene", "scheme", "school", "science", "scissors", "scorpion", "scout", "scrap", "screen", "script",
  "scrub", "sea", "search", "season", "seat", "second", "secret", "section", "security", "seed",
  "seek", "segment", "select", "sell", "seminar", "senior", "sense", "sentence", "series", "service",
  "session", "settle", "setup", "seven", "shadow", "shaft", "shallow", "share", "shed", "shell",
  "sheriff", "shield", "shift", "shine", "ship", "shiver", "shock", "shoe", "shoot", "shop",
  "short", "shoulder", "shove", "shrimp", "shrug", "shuffle", "shy", "sibling", "sick", "side",
  "siege", "sight", "sign", "silent", "silk", "silly", "silver", "similar", "simple", "since",
  "sing", "siren", "sister", "situate", "six", "size", "skate", "sketch", "ski", "skill",
  "skin", "skirt", "skull", "slab", "slam", "sleep", "slender", "slice", "slide", "slight",
  "slim", "slogan", "slot", "slow", "slush", "small", "smart", "smile", "smoke", "smooth",
  "snack", "snake", "snap", "sniff", "snow", "soap", "soccer", "social", "sock", "soda",
  "soft", "solar", "soldier", "solid", "solution", "solve", "someone", "song", "soon", "sorry",
  "sort", "soul", "sound", "soup", "source", "south", "space", "spare", "spatial", "spawn",
  "speak", "special", "speed", "spell", "spend", "sphere", "spice", "spider", "spike", "spin",
  "spirit", "split", "spoil", "sponsor", "spoon", "sport", "spot", "spray", "spread", "spring",
  "spy", "square", "squeeze", "squirrel", "stable", "stadium", "staff", "stage", "stairs", "stamp",
  "stand", "start", "state", "stay", "steak", "steel", "stem", "step", "stereo", "stick",
  "still", "sting", "stock", "stomach", "stone", "stool", "story", "stove", "strategy", "street",
  "strike", "strong", "struggle", "student", "stuff", "stumble", "style", "subject", "submit", "subway",
  "success", "such", "sudden", "suffer", "sugar", "suggest", "suit", "summer", "sun", "sunny",
  "sunset", "super", "supply", "supreme", "sure", "surface", "surge", "surprise", "surround", "survey",
  "suspect", "sustain", "swallow", "swamp", "swap", "swarm", "swear", "sweet", "swift", "swim",
  "swing", "switch", "sword", "symbol", "symptom", "syrup", "system", "table", "tackle", "tag",
  "tail", "talent", "talk", "tank", "tape", "target", "task", "taste", "tattoo", "taxi",
  "teach", "team", "tell", "ten", "tenant", "tennis", "tent", "term", "test", "text",
  "thank", "that", "theme", "then", "theory", "there", "they", "thing", "this", "thought",
  "three", "thrive", "throw", "thumb", "thunder", "ticket", "tide", "tiger", "tilt", "timber",
  "time", "tiny", "tip", "tired", "tissue", "title", "toast", "tobacco", "today", "toddler",
  "toe", "together", "toilet", "token", "tomato", "tomorrow", "tone", "tongue", "tonight", "tool",
  "tooth", "top", "topic", "topple", "torch", "tornado", "tortoise", "toss", "total", "tourist",
  "toward", "tower", "town", "toy", "track", "trade", "traffic", "tragic", "train", "transfer",
  "trap", "trash", "travel", "tray", "treat", "tree", "trend", "trial", "tribe", "trick",
  "trigger", "trim", "trip", "trophy", "trouble", "truck", "true", "truly", "trumpet", "trust",
  "truth", "try", "tube", "tuition", "tumble", "tuna", "tunnel", "turkey", "turn", "turtle",
  "twelve", "twenty", "twice", "twin", "twist", "two", "type", "typical", "ugly", "umbrella",
  "unable", "unaware", "uncle", "uncover", "under", "undo", "unfair", "unfold", "unhappy", "uniform",
  "unique", "unit", "universe", "unknown", "unlock", "until", "unusual", "unveil", "update", "upgrade",
  "uphold", "upon", "upper", "upset", "urban", "urge", "usage", "use", "used", "useful",
  "useless", "usual", "utility", "vacant", "vacuum", "vague", "valid", "valley", "valve", "van",
  "vanish", "vapor", "various", "vast", "vault", "vehicle", "velvet", "vendor", "venture", "venue",
  "verb", "verify", "version", "very", "vessel", "veteran", "viable", "vibrant", "vicious", "victory",
  "video", "view", "village", "vintage", "violin", "virtual", "virus", "visa", "visit", "visual",
  "vital", "vivid", "vocal", "voice", "void", "volcano", "volume", "vote", "voyage", "wage",
  "wagon", "wait", "walk", "wall", "walnut", "want", "warfare", "warm", "warrior", "wash",
  "wasp", "waste", "water", "wave", "way", "wealth", "weapon", "wear", "weasel", "weather",
  "web", "wedding", "weekend", "weird", "welcome", "west", "wet", "whale", "what", "wheat",
  "wheel", "when", "where", "whip", "whisper", "wide", "width", "wife", "wild", "will",
  "win", "window", "wine", "wing", "wink", "winner", "winter", "wire", "wisdom", "wise",
  "wish", "witness", "wolf", "woman", "wonder", "wood", "wool", "word", "work", "world",
  "worry", "worth", "wrap", "wreck", "wrestle", "wrist", "write", "wrong", "yard", "year",
  "yellow", "you", "young", "youth", "zebra", "zero", "zone", "zoo",
];

/**
 * Obtiene una palabra del diccionario BIP-39 de forma segura frente a
 * `noUncheckedIndexedAccess`, lanzando si el índice estuviera fuera de rango
 * (lo cual, matemáticamente, nunca debería ocurrir dado el enmascarado de 11
 * bits aplicado en `generateRecoveryPhrase`).
 */
function getWordAt(index: number): string {
  const word = BIP39_ENGLISH_WORDLIST[index];
  if (word === undefined) {
    throw new Error(`getWordAt: índice fuera de rango en el diccionario BIP-39 (${index}).`);
  }
  return word;
}

/**
 * Genera una frase de recuperación de 12 palabras a partir del diccionario
 * mnemónico BIP-39 en inglés, usando `crypto.getRandomValues` como fuente de
 * aleatoriedad criptográficamente segura.
 *
 * Nota de diseño: dado que 2048 (tamaño del diccionario) es exactamente
 * 2^11, se extraen 16 bits aleatorios por palabra y se enmascaran a 11 bits
 * (`& 0x07FF`). Como 65536 / 2048 = 32 exactamente, esta reducción de rango
 * NO introduce ningún sesgo de módulo: cada palabra del diccionario tiene
 * exactamente la misma probabilidad de ser seleccionada.
 *
 * Esta función es intencionalmente síncrona (no requiere `crypto.subtle`,
 * que es asíncrono), generando cada palabra de forma independiente en lugar
 * de derivar un único valor de entropía con checksum (como en la derivación
 * completa de semillas BIP-39), ya que aquí se usa como secreto de
 * recuperación de bóveda y no como semilla determinista de un wallet.
 */
export function generateRecoveryPhrase(): string {
  const randomWords = new Uint16Array(RECOVERY_PHRASE_WORD_COUNT);
  window.crypto.getRandomValues(randomWords);

  const words: string[] = [];
  for (const value of randomWords) {
    const index = value & ELEVEN_BIT_MASK;
    words.push(getWordAt(index));
  }

  return words.join(" ");
}

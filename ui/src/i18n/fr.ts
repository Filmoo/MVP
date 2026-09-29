/**
 * The UI's words, in French: exactly the shape of `en.ts` (the typecheck fails on a missing or
 * extra key); the other views' words are in `fr-views.ts`. Both load only when French is on.
 *
 * Typography: a no-break space (U+00A0) before `:` and `%` and inside « », a narrow one
 * (U+202F) before `;`, `!` and `?`, the typographic apostrophe ’. Riot's own French terms where
 * they exist (Classé en solo/duo, sorts d’invocateur, voie, clé de voûte, PL…).
 */
import type { Role } from "../data/generated/Role";
import { games } from "../lib/format";
import type { CoreMessages } from "./en";

/** 0 and 1 take the singular in French. */
export const plural = (n: number, one: string, other: string) => (n < 2 ? one : other);

/** `3 244 parties`, `127 k parties`, `1,9 M de parties` (a million takes « de »). */
export const count = (n: number, one: string, other: string) => `${games(n)} ${n >= 999_500 ? `de ${other}` : plural(n, one, other)}`;

/**
 * Roles as French players and stat sites name them. The League client says Haut, Milieu and Bas,
 * but next to the rest (and to a percentage: « Haut 94 % », « Bas 3 % » read as high and low)
 * the players' words read better.
 */
export const roles = { top: "Top", jungle: "Jungle", middle: "Mid", bottom: "Bot", support: "Support" } satisfies Record<Role, string>;

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export const fr = {
  common: {
    tryAgain: "Réessayer",
    dismiss: "Fermer",
    somethingWrong: "Un problème est survenu",
    comingSoon: "Bientôt disponible",
    panelFailed: "Ce panneau n’a pas pu se charger",
    unknown: "Inconnu",
    unranked: "Non classé",
    you: "Vous",
    champion: "Champion",
    yourChampion: "votre champion",
    thisChampion: "Ce champion",
    championN: (id: number) => `Champion ${id}`,
    itemN: (id: number) => `Objet ${id}`,
    spellN: (id: number) => `Sort ${id}`,
    runeN: (id: number) => `Rune ${id}`,
    runeTreeN: (id: number) => `Voie de runes ${id}`,
    profileIcon: "Icône de profil",
    games: (n: number) => count(n, "partie", "parties"),
    lp: (lp: number) => `${lp}\u00A0PL`,
    record: (wins: number, losses: number) => `${wins}V ${losses}D`,
    wins: (n: number) => `${n}V`,
    losses: (n: number) => `${n}D`,
    kda: (ratio: string) => `${ratio} KDA`,
    wr: (pct: string) => `${pct} de victoires`,
    patch: (name: string) => `Patch ${name}`,
    updated: (ago: string) => `mis à jour ${ago}`,
    lastResults: (results: readonly boolean[]) =>
      `${results.length === 1 ? "Dernière partie" : `${results.length} dernières parties`}\u00A0: ${results
        .map((w) => (w ? "victoire" : "défaite"))
        .join(", ")}`,
  },

  format: {
    perfect: "Parfait",
    justNow: "à\u00A0l’instant",
    and: "et",
  },

  days: {
    today: "Aujourd’hui",
    yesterday: "Hier",
    weekday: (date: Date) => {
      const day = new Intl.DateTimeFormat("fr-FR", { weekday: "long" }).format(date);
      return day.charAt(0).toUpperCase() + day.slice(1);
    },
    date: (date: Date) => `${date.getDate() === 1 ? "1er" : date.getDate()} ${MONTHS[date.getMonth()]}`,
  },

  roles,

  rolesShort: { top: "Top", jungle: "Jgl", middle: "Mid", bottom: "Bot", support: "Sup" } satisfies Record<Role, string>,

  tiers: {
    iron: "Fer",
    bronze: "Bronze",
    silver: "Argent",
    gold: "Or",
    platinum: "Platine",
    emerald: "Émeraude",
    diamond: "Diamant",
    master: "Maître",
    grandmaster: "Grand Maître",
    challenger: "Challenger",
  },

  classes: { Assassin: "Assassin", Fighter: "Combattant", Mage: "Mage", Marksman: "Tireur", Support: "Support", Tank: "Tank" } as Record<
    string,
    string
  >,

  queues: {
    400: "Mode Draft",
    420: "Classé solo/duo",
    430: "Mode Aveugle",
    440: "Classé flexible",
    450: "ARAM",
    480: "Partie accélérée",
    490: "Partie rapide",
    700: "Clash",
    720: "Clash ARAM",
    870: "Coop vs IA",
    880: "Coop vs IA",
    890: "Coop vs IA",
    900: "ARURF",
    1700: "Arena",
    1750: "Arena",
    1900: "URF",
    2400: "ARAM du chaos",
    4210: "Bots du chaos",
    4310: "Classic",
    4320: "Classic (Coop vs IA)",
    custom: "Personnalisée",
  },

  soloDuo: "Classé en solo/duo",

  nav: {
    main: "Principale",
    home: { label: "Accueil", short: "Accueil" },
    draft: { label: "Draft", short: "Draft" },
    live: { label: "Partie en cours", short: "Partie" },
    champions: { label: "Champions", short: "Champs" },
    tierList: { label: "Tier list", short: "Tiers" },
    settings: { label: "Paramètres", short: "Réglages" },
  },

  shell: {
    connection: {
      connected: "Client League connecté",
      connecting: "Connexion à League…",
      notRunning: "En attente du client League",
      notAnswering: "Le client League ne répond pas",
    },
    minimize: "Réduire",
    maximize: "Agrandir",
    close: "Fermer",
    matchAccepted: "Partie acceptée",
    acceptFailed: (message: string) => `Impossible d’accepter la partie\u00A0: ${message}`,
    notFound: {
      title: "Page introuvable",
      state: "Rien ici",
      text: "Cette page n’existe pas. Choisissez une section dans le menu.",
    },
  },

  search: {
    label: "Rechercher des champions et des joueurs",
    placeholder: "Champion ou Nom#TAG",
    region: "Région",
    results: "Résultats de la recherche",
    hint: "Cherchez un champion, ou un joueur par son Riot ID\u00A0:",
    example: "Nom#TAG",
    sections: { recent: "Récents", champions: "Champions", players: "Joueurs" },
    noChampion: "Aucun champion à ce nom",
    typeRiotId: "Tapez un Riot ID, comme Nom#TAG, pour trouver un joueur",
    player: (region: string) => `Joueur · ${region}`,
    searchOn: (riotId: string, region: string) => `Chercher ${riotId} sur ${region}`,
    searching: (region: string) => `Recherche sur ${region}…`,
    level: (level: number, region: string) => `Niveau ${level} · ${region}`,
    noPlayerOn: (region: string) => `Aucun joueur avec ce Riot ID sur ${region}`,
    checkFailed: "Vérification impossible pour l’instant · Entrée ouvre quand même la page",
    keys: { enter: "Entrée", esc: "Échap", move: "pour naviguer", open: "pour ouvrir", close: "pour fermer" },
    clearRecent: "Effacer les recherches récentes",
    again: "Chercher à nouveau",
  },

  home: {
    loadFailed: "Impossible de charger votre profil",
    notAnswering: {
      text: "Il est peut-être occupé. MVP continue d’essayer : votre profil s’affiche dès qu’il répond.",
      retry: "Réessayer maintenant",
    },
    waiting: {
      title: "En attente du client League",
      text: "Lancez League of Legends\u00A0: votre profil, vos parties en cours et l’aide à la sélection des champions s’affichent ici automatiquement.",
    },
  },

  profile: {
    level: (level: number) => `Niveau ${level}`,
    main: (champion: string) => `Main ${champion}`,
    last: (n: number) => (n === 1 ? "Dernière" : `${n} dernières`),
    winRate: (pct: string) => `Taux de victoire ${pct}`,
    lastGames: (n: number) => (n === 1 ? "Dernière partie" : `${n} dernières parties`),
    stats: {
      winRate: "Taux de victoire",
      kda: "KDA",
      csPerMinute: "CS par minute",
      mainRole: "Rôle principal",
      averageGame: "Durée moyenne",
    },
    roleShare: (games: number, of: number) => `${games} sur ${of}`,
  },

  matches: {
    title: "Historique des parties",
    outcome: { win: "Victoire", loss: "Défaite", remake: "Remake" },
    perfectKda: "KDA parfait",
    perMinute: (value: string) => `${value} / min`,
    empty: { title: "Aucune partie récente", text: "Terminez une partie et elle s’affiche ici, avec vos stats et votre build." },
  },

  grade: {
    place: (n: number) => (n === 1 ? "1er" : `${n}e`),
    mvp: "MVP",
    ace: "ACE",
    label: (letter: string) => `Note ${letter}`,
  },

  summary: {
    title: (n: number) => `Champions · ${n === 1 ? "dernière partie" : `${n} dernières parties`}`,
    championsTitle: "Champions",
    empty: { title: "Pas encore de stats", text: "Jouez quelques parties pour voir votre forme." },
    roles: "Rôles",
    remakes: (n: number) => (n < 2 ? `${n} remake non compté` : `${n} remakes non comptés`),
  },
} satisfies CoreMessages;

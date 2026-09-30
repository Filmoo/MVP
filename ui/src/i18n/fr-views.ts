/**
 * The French words of the views besides Home: exactly the shape of `en-views.ts`. Typography and
 * terms as in `fr.ts`.
 */
import type { Role } from "../data/generated/Role";
import { integer, signedPoints } from "../lib/format";
import type { ViewMessages } from "./en-views";
import { count, plural, roles } from "./fr";

/** `de Yasuo`, `d’Ahri`: « de » elides before a vowel. */
const de = (name: string) => (/^[aeiouyàâäéèêëîïôöûüœ]/i.test(name) && !/^y[aeiou]/i.test(name) ? `d’${name}` : `de ${name}`);

/** `Choix pour le mid`. */
const roleFor = { top: "le top", jungle: "la jungle", middle: "le mid", bottom: "le bot", support: "le support" } satisfies Record<
  Role,
  string
>;
/** `… de parties au mid`. */
const roleAt = { top: "au top", jungle: "en jungle", middle: "au mid", bottom: "au bot", support: "en support" } satisfies Record<
  Role,
  string
>;
const parts = { runes: "runes", itemSet: "set d’objets", spells: "sorts" };
/** `des runes`, `du set d’objets`. */
const ofParts = { runes: "des runes", itemSet: "du set d’objets", spells: "des sorts" };
/** Update progress: `(45 %)`. */
const progress = (pct: number | null) => (pct === null ? "" : ` (${pct}\u00A0%)`);

export const frViews = {
  soloDuoShort: "Solo/Duo",

  brackets: { emeraldPlus: "Émeraude+", diamondPlus: "Diamant+", masterPlus: "Maître+" },

  players: {
    badLink: { title: "Joueur introuvable", text: "Ce lien ne mène à aucun Riot ID." },
    notFound: {
      title: "Joueur introuvable",
      text: (riotId: string, region: string) => `Aucun joueur nommé ${riotId} sur ${region}. Vérifiez l’orthographe, le tag et la région.`,
    },
    rateLimited: {
      title: "Trop de recherches pour le moment",
      text: (seconds: number | null) =>
        seconds === null
          ? "Riot limite la vitesse des recherches de joueurs. Réessayez dans un instant."
          : `Riot limite la vitesse des recherches de joueurs. Réessayez dans ${seconds}\u00A0s.`,
    },
    unavailable: {
      title: "Recherche de joueurs indisponible",
      text: "Nos serveurs ne peuvent pas joindre Riot pour le moment. Réessayez dans un instant.",
    },
    network: { title: "Impossible de joindre les serveurs de MVP", text: "Vérifiez votre connexion Internet, puis réessayez." },
  },

  matchDetails: {
    columns: { damage: "Dégâts", gold: "Or", cs: "CS", vision: "Vision", grade: "Note" },
    level: (n: number) => `Niveau ${n}`,
    damageTitle: (damage: string) => `${damage} dégâts aux champions`,
    errors: {
      title: "Impossible d’ouvrir cette partie",
      notFound: "Cette partie n’est plus disponible.",
      unavailable: "Le serveur de MVP ne peut pas ouvrir de parties pour le moment. Réessayez dans un instant.",
    },
    note: "Chaque note compare le joueur aux neuf autres de la partie (participation aux éliminations, KDA, dégâts, vision et objectifs, CS et or face à l’adversaire de voie), selon son rôle. Elle juge une partie, pas un joueur.",
  },

  gradeWhy: {
    title: (letter: string, score: string) => `Note ${letter} · ${score} / 10`,
    place: (place: string) => `${place} sur 10 dans cette partie`,
    mvp: "MVP : meilleur de l’équipe gagnante",
    ace: "ACE : meilleur de l’équipe perdante",
    factors: {
      killParticipation: (pct: string) => `${pct} de participation aux éliminations`,
      damageShare: (pct: string) => `${pct} des dégâts de l’équipe`,
      damageTakenShare: (pct: string) => `${pct} des dégâts subis par l’équipe`,
      objectiveShare: (pct: string) => `${pct} des dégâts de l’équipe aux objectifs`,
      visionShare: (pct: string) => `${pct} du score de vision de l’équipe`,
      csLead: (diff: string) => `${diff} CS face à l’adversaire de voie`,
      goldLead: (diff: string) => `${diff} d’or face à l’adversaire de voie`,
    },
  },

  postGame: {
    title: "Votre dernière partie",
    close: "Fermer ce résumé",
    outOf: "sur 10",
    why: "Ce qui a pesé sur votre note",
    remake: "Un remake : pas de note, et la partie ne compte pas.",
    you: "Vous",
    laneOpponent: "Adversaire de voie",
    closestDamage: "Part de dégâts la plus proche",
    noOpponent: "Pas d’adversaire de voie à qui vous comparer dans cette partie.",
    rows: { kda: "KDA", cs: "CS", damage: "Dégâts", gold: "Or", vision: "Vision" },
    lp: {
      promoted: "Promu",
      demoted: "Rétrogradé",
      pending: "Calcul des PL de cette partie…",
      unknown: "PL non suivis pour cette partie",
    },
  },

  draft: {
    readFailed: "Impossible de lire la sélection des champions",
    idle: {
      title: "Pas en sélection des champions",
      text: "Dès que votre sélection des champions commence, les choix pour votre rôle s’affichent ici et suivent chaque survol, choix et bannissement.",
    },
    phases: { planning: "Planification", banning: "Bannissements", picking: "Choix", finalizing: "Finalisation" },
    yourTeam: "Votre équipe",
    enemyTeam: "Équipe adverse",
    bans: (enemy: boolean) => (enemy ? "Bannissements adverses" : "Bannissements de votre équipe"),
    hovering: "Survol",
    youHover: "Vous survolez ce champion",
    picking: "Choisit…",
    waiting: "À venir",
    winChance: "Chances de victoire",
    oddsAria: (us: string, plusMinus: string) => `Chances de victoire\u00A0: votre équipe ${us}, ± ${plusMinus}`,
    picks: "Choix",
    picksFor: (role: Role | null) => (role ? `Choix pour ${roleFor[role]}` : "Choix pour votre rôle"),
    ifPicked: "Chances si choisi",
    teamNow: (pct: string) => `Votre équipe actuellement\u00A0: ${pct}. Le petit nombre est l’écart.`,
    strength: "Force",
    vs: (champion: string) => `contre ${champion}`,
    with: (champion: string) => `avec ${champion}`,
    tier: (n: number) => `Tier ${n}`,
    best: (tied: boolean) => (tied ? "Meilleurs · à égalité statistique" : "Meilleur choix"),
    yourGames: (games: number, winRate: string) => (games < 2 ? `Vous · 1 partie · ${winRate}` : `Vos ${games} parties · ${winRate}`),
    yourMastery: (level: number) => `Vous · Maîtrise ${level}`,
    masteryTitle: (level: number, points: number) => `Votre maîtrise\u00A0: niveau ${level}, ${integer(points)}\u00A0points`,
    noSuggestions: { title: "Pas encore de suggestions", text: "Les suggestions s’affichent dès que votre rôle est connu." },
    noStats: {
      title: "Stats pas encore disponibles",
      text: "Les suggestions ont besoin des stats des champions, qui se téléchargent dès que notre service de stats est en ligne.",
    },
    aramPicks: "Le vôtre et le banc",
    yours: "Le vôtre",
    yoursMastery: (level: number) => `Le vôtre · Maîtrise ${level}`,
    rerolls: (n: number) => (n < 2 ? `${n}\u00A0relance restante` : `${n}\u00A0relances restantes`),
    aramWaiting: { title: "En attente de votre champion", text: "Le vôtre et le banc s’affichent ici." },
    enemiesHidden: "Visible au chargement de la partie",
  },

  why: {
    title: (champion: string | undefined) => (champion ? `Pourquoi ${champion}` : "Pourquoi"),
    kinds: { base: "Force", lane: "Voie", jungle: "Jungle", matchup: "Matchup", duo: "Duo" },
    empty: "Sélectionnez un choix pour voir comment son estimation se construit.",
    vsTeamNow: (pct: string) => `par rapport à l’équipe actuelle (${pct})`,
    kept: (pct: string) => `${pct} retenu`,
    weak: (pct: string) => `peu de données, ${pct} retenu`,
    keptTitle: (pct: string) => `Les petits échantillons sont ramenés vers zéro\u00A0: ${pct} de l’effet observé est retenu.`,
    roleOdds: (pct: string) => `rôle probable à ${pct}`,
    roleOddsTitle: (pct: string) => `Ne compte que si le rôle deviné est le bon (probable à ${pct}).`,
    yourGames: (n: number) => `Vous\u00A0: ${n} ${plural(n, "partie", "parties")}`,
    notInEstimate: "hors estimation",
    notInEstimateTitle: "Vos propres parties sont affichées pour info\u202F; l’estimation utilise les parties de tout le monde.",
    tabs: { pick: "Choix", teams: "Équipes" },
    tabsLabel: "Expliquer",
    teamsTitle: "Compositions",
    withPick: (champion: string) => `Votre équipe avec ${champion}`,
  },

  comps: {
    none: "—",
    rows: {
      champions: "Champions",
      damage: "Dégâts",
      physical: "Physiques",
      magic: "Magiques",
      trueDamage: "Bruts",
      frontline: "Frontline",
      cc: "Contrôle de foule",
      late: "Fin de partie",
      games: "Parties chacun",
    },
    physicalDamage: "Dégâts physiques",
    magicDamage: "Dégâts magiques",
    times: (x: string) => `${x}×`,
    seconds: (s: string) => `${s}\u00A0s`,
    atLeast: (n: string) => `≥\u00A0${n}`,
    change: (label: string, from: string, to: string) => `${label} ${from}\u00A0→ ${to}`,
    value: (label: string, value: string) => `${label}\u00A0: ${value}`,
    frontlineTitle: (x: string) => `Dégâts subis et atténués\u00A0: ${x} l’habitude à ces rôles`,
    ccTitle: (usual: string) => `Par partie, additionné (d’habitude\u00A0: ${usual}\u00A0s)`,
    lateTitle: (buckets: string) => `Victoires par rapport à l’habitude, en points\u00A0: ${buckets}`,
    under: (minutes: number) => `moins de ${minutes}\u00A0min`,
    between: (from: number, to: number) => `${from} à ${to}\u00A0min`,
    over: (minutes: number) => `${minutes}\u00A0min et plus`,
    bucket: (length: string, points: string) => `${length}\u00A0: ${points}`,
    readings: {
      mostlyPhysical: "Surtout des dégâts physiques",
      mostlyMagic: "Surtout des dégâts magiques",
      littleFrontline: "Peu de frontline",
      lotsOfFrontline: "Beaucoup de frontline",
      littleCc: "Peu de contrôle",
      lotsOfCc: "Beaucoup de contrôle",
      early: "Plus forte en partie courte",
      late: "Plus forte en partie longue",
    },
    waiting: "En attente des choix",
    note: (bracket: string, patch: string) =>
      `Valeurs habituelles à chaque rôle (adversaires\u00A0: rôles probables) · ${bracket} · patch ${patch} · hors estimation`,
    noteAram: (bracket: string, patch: string) => `Valeurs habituelles en ARAM · ${bracket} · patch ${patch} · hors estimation`,
    noStats: { title: "Pas encore de compositions", text: "Elles arrivent avec les stats des champions." },
    noComps: { title: "Pas encore de compositions", text: "Elles arrivent avec la prochaine mise à jour des stats." },
  },

  imports: {
    title: "Importer le build",
    parts: { runes: "Runes", itemSet: "Set d’objets", spells: "Sorts" },
    nouns: parts,
    importPart: (part: "runes" | "itemSet" | "spells") =>
      ({ runes: "Importer les runes", itemSet: "Importer le set d’objets", spells: "Importer les sorts" })[part],
    auto: "Importé aussi tout seul à votre premier verrouillage",
    idle: (flash: string) => `Vos pages de runes et sets d’objets ne sont jamais modifiés, et ${flash} reste sur votre touche.`,
    warning: {
      text: (built: string, now: string) => `Le build de MVP est pour ${built}, vous jouez maintenant ${now}.`,
      importFor: (now: string) => `Importer pour ${now}`,
    },
    pickFirst: "Survolez ou verrouillez d’abord un champion",
    pick: "Survolez ou verrouillez un champion",
    notYet: "Les builds arrivent avec les stats des champions, pas encore disponibles",
    notYetStatus: "Les builds arrivent avec les stats des champions, qui ne sont pas encore disponibles.",
    spellsInChampSelect: "Les sorts ne peuvent changer qu’en sélection des champions",
    needsClient: "Ouvrez le client League pour y importer",
    hovering: "survolé",
    lockedIn: "verrouillé",
    mostPlayedIn: (queue: 420 | 450, bracket: string) => `build le plus joué en ${queue === 450 ? "ARAM" : "Solo/Duo"} · ${bracket}`,
    failed: (message: string) => `Import impossible\u00A0: ${message}`,
    fail: {
      noClient: "Le client League n’est pas connecté.",
      notAnswering: "Le client League n’a pas répondu. Il est peut-être occupé : réessayez, ou redémarrez-le.",
      noBuild: "Pas encore de build pour ce champion et ce rôle dans les stats.",
      noRunes: "Les stats n’ont pas encore de page de runes complète pour ce build.",
      noItems: "Les stats n’ont pas encore d’objets pour ce build.",
      noSpells: "Les stats n’ont pas encore de sorts d’invocateur pour ce build.",
      unsupportedMode: "MVP n’a pas de builds pour ce mode de jeu.",
      noFreePage: "Aucune page de runes libre\u00A0: supprimez-en une, ou renommez-en une «\u00A0MVP\u00A0» pour que MVP l’utilise.",
      client: (message: string) => `Le client League a refusé\u00A0: ${message}`,
    },
    skip: {
      paused: "Mis en pause par MVP le temps de l’adapter à la dernière version du client League.",
      notInChampSelect: "Les sorts ne peuvent changer qu’en sélection des champions.",
      champSelectEnded: "La sélection des champions s’est terminée avant l’import.",
      tooLate: (seconds: number) =>
        seconds > 0
          ? `Sorts inchangés\u00A0: plus que ${seconds}\u00A0s de sélection des champions.`
          : "Sorts inchangés\u00A0: la partie commence.",
    },
    flash: {
      kept: (flash: string, key: string) => `${flash} reste sur ${key}, votre touche habituelle.`,
      guessed: (flash: string, key: string) =>
        `Pas de ${flash} dans vos parties récentes, il va donc sur ${key}. Choisissez votre touche dans les paramètres.`,
      notInBuild: (flash: string) => `Ce build ne prend pas ${flash}.`,
    },
    savedRunes: (name: string) => `«\u00A0${name}\u00A0» est votre page de runes actuelle.`,
    savedItemSet: (name: string) => `Le set d’objets «\u00A0${name}\u00A0» est dans la boutique.`,
    spellsOn: (d: string, f: string) => `${d} sur D, ${f} sur F.`,
    spellsSet: (spells: string) => `Sorts en place\u00A0: ${spells}`,
    spellsAlready: (spells: string) => `Sorts déjà en place\u00A0: ${spells}`,
    imported: (list: string) => `Import réussi\u00A0: ${list}.`,
    importedFor: (list: string, champion: string) => `Import pour ${champion}\u00A0: ${list}.`,
    notesFor: (champion: string, notes: string) => `${champion}\u00A0: ${notes}`,
    failedFor: (part: "runes" | "itemSet" | "spells", champion: string, reason: string) =>
      `Échec de l’import ${ofParts[part]} pour ${champion}\u00A0: ${reason}`,
  },

  live: {
    title: "Partie en cours",
    show: "Afficher",
    tabs: { players: "Joueurs", build: "Mon build" },
    lookingUp: "Recherche des joueurs…",
    names: {
      waiting: "Noms après le chargement",
      filtered: (queue: string) => `Noms après le chargement\u00A0: Riot ne partage pas les parties en ${queue} en cours`,
    },
    readFailed: "Impossible de lire la partie",
    idle: {
      title: "Pas en partie",
      text: "Dès que votre partie charge, tous ses joueurs s’affichent ici\u00A0: rang, forme récente et expérience sur leur champion.",
    },
    scouting: {
      busy: (seconds: number | null) =>
        seconds === null
          ? "Les serveurs de Riot sont surchargés\u00A0: cartes des joueurs en pause"
          : `Les serveurs de Riot sont surchargés\u00A0: cartes des joueurs en pause pendant ${seconds}\u00A0s`,
      network: "Impossible de joindre les serveurs de MVP\u00A0: pas de cartes des joueurs",
      unavailable: "Les cartes des joueurs sont indisponibles pour le moment",
    },
    otp: (champion: string) => `One-trick ${champion}`,
    otpTitle: (share: string, champion: string) => `${share} des parties classées récentes sur ${champion}`,
    streak: (wins: number) => `${wins} victoires d’affilée`,
    streakTitle: (wins: number) => `A gagné ses ${wins} dernières parties classées`,
    veteran: "Vétéran",
    veteranTitle: (n: number) => `${integer(n)} ${plural(n, "partie classée", "parties classées")} cette saison`,
    kdaOn: (kda: string, champion: string | undefined) => `${kda} KDA sur ${champion ?? "ce champion"}`,
    wr: "WR",
    mostPlayed: "Les plus joués récemment",
    poolTitle: (champion: string, n: number, winRate: string) =>
      `${champion}\u00A0: ${n} ${plural(n, "partie", "parties")}, ${winRate} de victoires`,
    streamer: "Mode streamer",
    mains: (list: string) => `Main ${list}`,
    hidden: "Joueur masqué",
    bot: "Bot IA",
    unknown: "Joueur inconnu",
    cardUnavailable: "Carte indisponible",
    noRankedData: "Aucune partie classée",
    build: {
      page: "page du champion",
      noMode: { title: "Pas de builds pour ce mode", text: "Les builds de MVP couvrent la Faille de l’invocateur et l’ARAM." },
      noChampion: { title: "Champion pas encore connu", text: "Votre build s’affiche dès que la partie indique votre champion." },
    },
  },

  stats: {
    queue: "File",
    rank: "Rang",
    rankHint: "Les parties que comptent les stats : celles des joueurs de ce rang et au-dessus.",
    role: "Rôle",
    allRoles: "Tous les rôles",
    errors: {
      notFound: {
        title: "Pas encore de stats publiées",
        text: "Rien n’est encore compté pour cette file et ce rang sur le patch actuel. Les stats s’affichent ici dès leur publication.",
      },
      rateLimited: {
        title: "Trop de requêtes pour le moment",
        text: (seconds: number | null) => (seconds === null ? "Réessayez dans un instant." : `Réessayez dans ${seconds}\u00A0s.`),
      },
      unavailable: {
        title: "Stats indisponibles",
        text: "Notre service de stats ne peut pas répondre pour le moment. Réessayez dans un instant.",
      },
      network: {
        title: "Impossible de joindre les serveurs de MVP",
        text: "Vérifiez votre connexion Internet, puis réessayez. Les stats déjà consultées restent disponibles hors ligne.",
      },
    },
    tier: (grade: string) => `Tier ${grade}`,
    noGamesOf: (champion: string) => `Pas encore de parties ${de(champion)}`,
    nothingCounted: (scope: string) => `Rien de compté en ${scope} sur ce patch pour l’instant.`,
    nothingCountedNew: (scope: string) =>
      `Rien de compté en ${scope} sur ce patch pour l’instant\u00A0: les nouveaux champions arrivent après leurs premières parties.`,
    notEnoughGames: "Pas encore assez de parties.",
    winsInGames: (wins: number, n: number) =>
      `${integer(wins)} ${plural(wins, "victoire", "victoires")} sur ${integer(n)} ${plural(n, "partie", "parties")}`,
    pickedIn: (n: number, of: number) => `Choisi dans ${integer(n)} ${plural(n, "partie", "parties")} sur ${integer(of)}`,
    pick: "choix",
  },

  tierList: {
    title: "Tier list",
    note: "Les tiers viennent du score\u00A0: le taux de victoire ramené vers 50\u00A0% comme si chaque champion avait 1\u202F000 parties de plus à 50\u00A0% (un petit échantillon chanceux ne peut donc pas prendre la tête), moins 50\u00A0%. S ≥ +2 · A ≥ +0,75 · B ≥ −0,75 · C ≥ −2 · D en dessous. Les taux de sélection et de bannissement sont des parts de toutes les parties comptées.",
    columns: {
      rank: "#",
      champion: "Champion",
      lane: "Voie",
      tier: "Tier",
      winRate: "Victoires",
      pick: "Choix",
      ban: "Bans",
      games: "Parties",
    },
    titles: {
      rank: "Rang selon le score",
      lane: "La voie, et la part des parties du champion jouées dans celle-ci",
      tier: "S ≥ +2 · A ≥ +0,75 · B ≥ −0,75 · C ≥ −2 · D en dessous (score, en points)",
      winRate:
        "Taux de victoire ramené vers 50\u00A0% (les petits échantillons comptent moins)\u00A0; dessous, son évolution depuis le patch précédent",
      pick: "Part des parties avec ce champion dans cette voie",
      ban: "Part des parties où il a été banni",
      games: "Parties comptées",
    },
    empty: {
      title: "Aucun champion classé ici pour l’instant",
      text: "Un champion a besoin d’assez de parties dans un rôle pour être classé. Essayez un autre rôle ou un autre rang.",
    },
    showAll: (n: number) => `Tout afficher (${n})`,
    views: { label: "Affichage", shelves: "Étagères", table: "Tableau" },
    filter: "Filtrer les champions",
    noMatch: "Aucun champion ne correspond au filtre",
    noStats: (reason: string) => `${reason}. Les champions sont groupés par classe en attendant les tiers et les taux de sélection.`,
    champions: (n: number) => `${integer(n)} ${plural(n, "champion", "champions")}`,
    average: (pct: string) => `moy. ${pct}`,
    tileLabel: (name: string, role: string | undefined, winRate: string) =>
      `${name}${role ? `, ${role}` : ""}\u00A0: ${winRate} de victoires`,
    rankN: (rank: number) => `${rank}${rank === 1 ? "er" : "e"}`,
    rankIn: (rank: number, role: Role) => `${rank}${rank === 1 ? "er" : "e"} ${roleAt[role]}`,
    podium: "Les trois premiers",
    sincePrevious: "depuis le patch précédent",
    map: {
      title: "Carte de la méta",
      open: "Ouvrir la carte de la méta",
      close: "Fermer la carte de la méta",
      strength: "Force",
      popularity: "Popularité",
      even: "50\u00A0%",
      hidden: "Forts, peu choisis",
      meta: "Forts et populaires",
      traps: "Populaires, sous la moyenne",
      pointLabel: (name: string, winRate: string, pick: string) => `${name}\u00A0: ${winRate} de victoires, ${pick} de sélection`,
    },
  },

  champions: {
    classes: "Classes",
    record: "Bilan",
    noneYet: "Aucun champion pour l’instant",
    checkSpelling: "Vérifiez l’orthographe, ou effacez la recherche.",
    whenLoaded: "Les champions s’affichent une fois les données du jeu et les stats chargées.",
    noBuild: {
      title: "Pas encore de données de build",
      text: (champion: string, role: Role | undefined) =>
        `${champion} a besoin de plus de parties${role ? ` ${roleAt[role]}` : ""} avant que son build soit publié.`,
    },
    // Plural from 2, as shown (rounded): « +0,8 pt », « +3,1 pts ». A non-breaking hyphen: tabular
    // figures (the line is numbers) would widen a plain one.
    pointsVs50: (score: number) =>
      `${signedPoints(score)}\u00A0${Math.abs(Number(score.toFixed(1))) >= 2 ? "pts" : "pt"} ${score >= 0 ? "au\u2011dessus de" : "en dessous de"} 50\u00A0%`,
    pointsTitle: "Taux de victoire lissé moins 50\u00A0%, en points (la base du tier)",
    winRate: "Taux de victoire",
    pickRate: "Taux de sélection",
    banRate: "Taux de ban",
    patch: "Patch",
    // Next to a rank, « Solo/Duo » says the queue: the line then fits a laptop screen.
    // Each dot goes to the next line with what follows it (no-break space after it).
    patchDetail: (queue: 420 | 450, bracket: string, ago: string) =>
      `${queue === 450 ? "ARAM" : "Solo/Duo"} ·\u00A0${bracket} ·\u00A0${ago}`,
    ofGames: (n: number) => `sur ${count(n, "partie", "parties")}`,
    bans: (n: number) => count(n, "ban", "bans"),
    shrunkTitle: (wins: number, n: number, raw: string) =>
      `Ramené vers 50\u00A0%\u00A0: ${integer(wins)} ${plural(wins, "victoire", "victoires")} sur ${integer(n)} ${plural(n, "partie", "parties")}, soit ${raw} brut`,
    build: "Build",
    runes: "Runes",
    shards: "Fragments",
    keystone: "Clé de voûte",
    secondaryTree: "voie secondaire",
    runePage: (keystone: string, secondary: string, winRate: string, pick: string) =>
      `${keystone} avec ${secondary}\u00A0: ${winRate} de victoires, choisie dans ${pick} des parties`,
    mostPlayedPages: "Pages les plus jouées",
    spells: "Sorts d’invocateur",
    skills: "Ordre des compétences",
    maxOrder: (keys: readonly string[]) => `Monter ${keys.join(", puis ")}`,
    maxLabel: "Priorité de montée",
    levelsLabel: (levels: number) => `Niveaux 1 à ${levels}`,
    firstPointsLabel: "Compétence prise à chacun des premiers niveaux",
    items: "Objets",
    starting: "Objets de départ",
    boots: "Bottes",
    core: "Build principal",
    // « ᵉ » has no capital: the uppercase caption still reads 4ᵉ.
    nth: (n: number) => `${n}ᵉ objet`,
    matchups: "Matchups",
    lane: "Voie",
    vsJungler: "Jungler adverse",
    duos: "Coéquipiers",
    bestWith: "Meilleurs avec",
    bestAgainst: "Meilleurs contre",
    worstWith: "Pires avec",
    worstAgainst: "Pires contre",
    noEffect: "Pas encore d’effet net.",
    effectOf: (points: string) =>
      `${points}\u00A0pts sur le taux de victoire, au-delà de la force propre des deux champions (atténué quand il y a peu de parties).`,
    effectNote:
      "En couleur\u00A0: l’effet du matchup sur le taux de victoire, en points, au-delà de la force propre de chaque champion (atténué quand il y a peu de parties).",
    aram: {
      title: "Pas de matchups en ARAM.",
      text: "Tout le monde partage une seule voie avec des équipes aléatoires\u00A0: il n’y a pas d’adversaire de voie à mesurer. Les builds restent valables.",
    },
    noMatchups: { title: "Pas encore assez de parties", text: "Les matchups s’affichent dès que ce rôle compte assez de parties." },
    buildTitle: (champion: string, role: Role | undefined) => `Build ${champion} ${role ? roles[role] : "ARAM"}`,
    summary: { runes: "Runes", spells: "Sorts", skills: "Compétences", core: "Objets principaux" },
    buildRecord: (n: number) => `de victoires · ${count(n, "partie", "parties")}`,
  },

  mayhem: {
    augments: "Augments",
    rarity: "Rareté",
    rarities: { silver: "Argent", gold: "Or", prismatic: "Prismatique" },
    all: "Tous",
    tier: (tier: string) => `Tier ${tier}`,
    ranked: (tier: string, rank: number) => `Tier ${tier} · n° ${rank}`,
    untiered: "Pas encore classés",
    tierHint: "Les tiers de MVP, faits à la main de S (le meilleur) à C : dans un tier, le premier est le meilleur.",
    picked: (pct: string) => `choisi dans ${pct} des parties`,
    pickedBy: (pct: string, champion: string) => `choisi dans ${pct} des parties ${de(champion)}`,
    held: (pct: string) => `dans ${pct} des parties`,
    tiersOf: (patch: string) => `Tiers de MVP · patch ${patch}`,
    tiersBy: "Tiers de MVP",
    shared: (n: number) => count(n, "partie partagée", "parties partagées"),
    order: {
      byRate: (champion: string, n: number) =>
        `Selon les tiers de MVP, le meilleur d’abord ; puis les augments sans tier que les joueurs ${de(champion)} choisissent. Taux de sélection sur ${count(n, "partie partagée", "parties partagées")}.`,
      byTier: (champion: string, n: number, min: number) =>
        `Selon les tiers de MVP : ${champion} compte ${count(n, "partie partagée", "parties partagées")} sur les ${min} nécessaires pour ajouter ses taux de sélection.`,
      byPicks: (champion: string, n: number) =>
        `Pas encore de tiers : selon la fréquence à laquelle les joueurs ${de(champion)} les choisissent (${count(n, "partie partagée", "parties partagées")}).`,
    },
    none: "Rien à classer pour l’instant : pas de tiers, et pas assez de parties partagées.",
    mostPicked: "Les plus choisis",
    items: "Objets fréquents",
    of: (champion: string) => `Augments ${de(champion)}`,
    champion: "Champion",
    search: "Filtrer par champion",
    clear: "Tous les champions",
    page: "Page ARAM du chaos",
    aramBuilds: "Builds ARAM",
    aramNote: "Tirés des parties d’ARAM : Riot garde les parties du chaos privées, aucune n’est comptée.",
    noTiers: {
      title: "Pas encore de tiers",
      text: "Les tiers de MVP pour les augments du chaos arrivent bientôt. En attendant, tous les augments sont listés.",
    },
    noShared: {
      title: "Aucune partie du chaos partagée pour l’instant",
      text: "Activez « Aider aux stats du chaos » dans les paramètres : vos parties d’ARAM du chaos compteront alors dans les taux de sélection.",
      link: "Ouvrir les paramètres",
    },
    unbuilt: {
      title: "Les augments ne sont pas encore disponibles",
      text: "Le serveur de MVP lit les augments de ce patch. Réessayez dans quelques minutes.",
    },
    failed: "Impossible de charger les augments du chaos",
    note: "Les tiers sont les choix de MVP, faits à la main : dans un tier, le premier est le meilleur. Les taux de sélection comptent les parties que les joueurs partagent avec « Aider aux stats du chaos ». Aucun taux de victoire : Riot ne les autorise pas pour les augments. Rien ici ne réagit à ce que votre partie propose.",
  },

  shards: {
    rows: { offense: "Attaque", flex: "Flexible", defense: "Défense" },
    names: {
      5001: { name: "PV évolutifs", stat: "+10–180\u00A0PV (selon le niveau)" },
      5002: { name: "Armure", stat: "+6 armure" },
      5003: { name: "Résistance magique", stat: "+8 résistance magique" },
      5005: { name: "Vitesse d’attaque", stat: "+10\u00A0% de vitesse d’attaque" },
      5007: { name: "Accélération de compétence", stat: "+8 accélération de compétence" },
      5008: { name: "Force adaptative", stat: "+9 force adaptative" },
      5010: { name: "Vitesse de déplacement", stat: "+2,5\u00A0% de vitesse de déplacement" },
      5011: { name: "PV", stat: "+65\u00A0PV" },
      5013: { name: "Ténacité et résistance aux ralentissements", stat: "+15\u00A0% de ténacité et de résistance aux ralentissements" },
    },
    unknown: "Fragment de stats",
    unknownN: (id: number) => `Fragment de stats ${id}`,
  },

  tip: {
    gold: (cost: string) => `${cost}\u00A0PO`,
    spell: "Sort d’invocateur",
    cooldown: (seconds: number) => `${seconds}\u00A0s de recharge`,
    rune: "Rune",
    tree: "Voie de runes",
    tiers: {
      S: "Parmi les meilleurs choix de ce patch\u00A0: son taux de victoire dépasse 50\u00A0% d’au moins 2 points, petits échantillons lissés.",
      A: "Un bon choix\u00A0: de 0,75 à 2 points au-dessus de 50\u00A0%.",
      B: "Plutôt équilibré\u00A0: à moins de 0,75 point de 50\u00A0%.",
      C: "Un choix plus faible\u00A0: de 0,75 à 2 points sous 50\u00A0%.",
      D: "Parmi les choix les plus faibles de ce patch\u00A0: au moins 2 points sous 50\u00A0%.",
    },
    nav: {
      home: "Votre profil, votre rang et vos dernières parties, chacune avec sa note.",
      draft: "La sélection des champions\u00A0: les choix que les stats favorisent pour votre rôle, et pourquoi.",
      live: "Votre partie en cours\u00A0: le rang et la forme de chaque joueur, et votre build.",
      tierList: "Les champions classés selon leurs victoires dans chaque rôle sur ce patch, et le build de chacun.",
      settings: "Automatisations, import de builds, langue, effets visuels et mises à jour.",
    },
    status: {
      connected: "MVP y suit vos parties, la sélection des champions et la partie en cours.",
      connecting: "Le client League démarre\u00A0: MVP s’y connecte tout seul.",
      notRunning: "Lancez League of Legends\u00A0: MVP s’y connecte tout seul, rien à régler.",
      notAnswering: "Il est lancé mais ne répond pas, peut-être occupé\u00A0: MVP réessaie tout seul.",
    },
  },

  settings: {
    title: "Paramètres",
    loadFailed: "Impossible de charger vos paramètres",
    saveFailed: (message: string) => `Impossible d’enregistrer ce changement. ${message}`,
    seconds: (n: number) => `${n}\u00A0s`,
    spokenSeconds: (n: number) => `${n} ${plural(n, "seconde", "secondes")}`,
    automation: {
      title: "Automatisation",
      autoAccept: {
        title: "Accepter les parties automatiquement",
        text: "Accepte la partie trouvée à votre place, après un court délai pour que vous la voyiez quand même. Refuser dans le client reste prioritaire.",
      },
      delay: "Délai avant d’accepter",
      bringToFront: { title: "Mettre MVP au premier plan", text: "Affiche la fenêtre dès que votre sélection des champions commence." },
      autoSwitch: {
        title: "Changer de page avec la partie",
        text: "Draft en sélection des champions, Partie en cours au chargement, Accueil à la fin. Les pages que vous ouvrez vous-même restent ouvertes.",
      },
      paused:
        "L’acceptation automatique est en pause pour tout le monde, le temps de corriger un problème avec le client League. Votre choix est conservé et refonctionnera dès que ce sera corrigé.",
    },
    stats: {
      title: "Statistiques",
      bracket: "Rang",
      bracketText: "Les parties à partir de ce rang comptent pour le draft, les builds importés et, au départ, les pages de stats.",
      shareMayhem: {
        title: "Aider aux stats du chaos",
        text: "Après chaque partie d’ARAM du chaos (et une fois pour les récentes quand vous l’activez), MVP envoie à son serveur le champion, les augments et les objets finaux de chaque joueur, avec un code à sens unique pour la partie. Aucun nom, aucun identifiant de joueur, aucune victoire.",
      },
      sharePaused: "Le partage est en pause pour tout le monde pour l’instant. Votre choix est conservé.",
    },
    imports: {
      title: "Importations",
      auto: "Import automatique",
      runes: {
        title: "Page de runes",
        text: "Écrit les runes du build dans la page de MVP, nommée «\u00A0MVP\u00A0», et la sélectionne. Vos pages ne sont jamais modifiées.",
      },
      itemSet: {
        title: "Set d’objets",
        text: "Ajoute le build à la boutique en jeu comme set de MVP pour le champion. Vos sets d’objets ne sont jamais modifiés.",
      },
      spells: {
        title: "Sorts d’invocateur",
        text: "Règle les sorts du build en sélection des champions, jamais dans ses 5 dernières secondes.",
      },
      flashKey: {
        title: (flash: string) => `Touche de ${flash}`,
        text: (flash: string) => `${flash} va toujours sur cette touche, quel que soit le build.`,
      },
      fromGames: "D’après vos parties",
      footnote:
        "L’import automatique se fait une fois, à votre premier verrouillage. Après un échange ou un changement de rôle, Draft propose d’importer de nouveau\u00A0: MVP ne le fait jamais tout seul. Les boutons de Draft et des pages de champion marchent toujours.",
    },
    app: {
      title: "Application",
      closeToTray: {
        title: "Réduire dans la zone de notification",
        text: "Fermer la fenêtre laisse MVP tourner dans la zone de notification, pour que les automatisations continuent. Quittez depuis son icône.",
      },
      launchAtStartup: { title: "Lancer au démarrage", text: "Démarre MVP avec Windows, discrètement dans la zone de notification." },
      crashReports: {
        title: "Envoyer les rapports de plantage",
        text: "Quand MVP plante ou qu’un panneau échoue, il envoie l’erreur et les versions de l’app et de Windows au serveur de MVP. Les noms de joueurs, identifiants et chemins de fichiers sont retirés avant l’envoi, et les rapports sont supprimés au bout de 30\u00A0jours.",
      },
      reportId: {
        title: "ID de rapport",
        text: "Aléatoire et sans lien avec votre compte Riot\u00A0: il permet de supprimer vos rapports sur demande.",
      },
      effects: {
        title: "Effets visuels",
        text: "La quantité de verre et de lumière que MVP affiche. «\u00A0Complet\u00A0» réfracte la lumière comme du vrai verre, si votre carte graphique le permet sans effort.",
        levels: { full: "Complet", light: "Léger", off: "Aucun" },
        fallback: (reason: string) => `Affichage en Léger pour l’instant\u00A0: ${reason}.`,
        windowsOff:
          "Léger, car les effets de transparence de Windows sont désactivés. Choisissez «\u00A0Complet\u00A0» pour garder le verre.",
        reasons: {
          "no-webgl": "ce PC n’a pas d’accélération graphique pour la fenêtre",
          slow: "votre carte graphique ne peut pas l’afficher sans effort",
          "context-lost": "le pilote graphique a redémarré\u202F; l’effet revient tout seul",
        } as Record<string, string>,
      },
      language: { title: "Langue", text: "Auto suit la langue de Windows." },
    },
    about: {
      title: "À propos",
      version: "Version",
      unknownVersion: "Version inconnue",
      platforms: { windows: "Windows", macos: "macOS", linux: "Linux", web: "Aperçu navigateur" } as Record<string, string>,
      updates: "Mises à jour",
      dataTitle: "Vos données",
      data: "MVP lit le client League sur cet ordinateur et garde vos paramètres ici, sans compte. Les recherches de joueurs et les cartes de l’écran de chargement passent par le serveur de MVP, qui interroge Riot. Les rapports de plantage ne sont envoyés que si vous les activez. Les noms et icônes du jeu viennent du Data Dragon de Riot.",
      helpTitle: "Un souci\u00A0?",
      help: "Copiez le diagnostic dans votre message\u00A0: il dit ce que faisaient MVP et le client League, sans votre nom ni votre compte.",
      copy: "Copier le diagnostic",
      copied: "Copié\u00A0: collez-le dans votre message.",
      copyFailed: "Copie impossible\u00A0: le dossier des journaux contient la même chose.",
      openLogs: "Ouvrir le dossier des journaux",
      legalTitle: "Mentions légales",
      legal:
        "MVP n’est pas approuvé par Riot Games et ne reflète pas les opinions de Riot Games ni de quiconque officiellement impliqué dans la production ou la gestion des propriétés de Riot Games. Riot Games et toutes les propriétés associées sont des marques commerciales ou des marques déposées de Riot Games, Inc.",
    },
    search: {
      label: "Rechercher un paramètre",
      shortcut: "Ctrl F",
      clear: "Effacer la recherche",
      noMatch: (query: string) => `Aucun paramètre ne correspond à « ${query} »`,
      tryOther: "Essayez un autre mot, ou moins de mots.",
      keywords: {
        autoAccept: "acceptation, file d’attente, queue, ready check",
        bringToFront: "focus, avant-plan",
        runes: "rune clé, keystone",
        itemSet: "items, stuff",
        spells: "summoners",
        flashKey: "flash, D, F, raccourci",
        bracket: "elo, ranked, classé",
        shareMayhem: "augments, ARAM du chaos, Mayhem, partager, statistiques",
        language: "Français, anglais, English",
        closeToTray: "tray, systray, arrière-plan",
        launchAtStartup: "boot, autostart, startup",
        crashReports: "bug, crash, télémétrie",
        effects: "flou, transparence, animations",
        updates: "version, maj, update",
        data: "confidentialité, vie privée",
        help: "logs, bug, support, problème",
      },
    },
  },

  updates: {
    unavailable: (reason: string) => `Cette copie de MVP ne se met pas à jour toute seule (${reason}).`,
    idle: "MVP recherche les mises à jour automatiquement, plusieurs fois par jour.",
    check: "Rechercher des mises à jour",
    checking: "Recherche de mises à jour…",
    upToDate: "MVP est à jour.",
    available: (version: string) => `La version ${version} est sortie\u00A0: elle se télécharge dès qu’aucune partie n’est en cours.`,
    downloading: (version: string, pct: number | null) => `Téléchargement de la version ${version}${progress(pct)}…`,
    ready: (version: string) =>
      `La version ${version} est prête\u00A0: elle s’installe quand vous redémarrez MVP, ou quand vous le quittez.`,
    restart: "Redémarrer pour mettre à jour",
    failed: (message: string) => `Impossible de rechercher les mises à jour\u00A0: ${message}.`,
    restartFailed: (message: string) => `Impossible de redémarrer sur la mise à jour\u00A0: ${message}`,
    required: {
      title: "Mettez MVP à jour pour continuer",
      unsupported: "Cette version de MVP n’est plus prise en charge.",
      inGame: "Terminez d’abord votre partie\u00A0: MVP se met à jour juste après.",
      ready: (version: string) => `MVP ${version} est téléchargé et prêt.`,
      downloading: (version: string, pct: number | null) => `Téléchargement de MVP ${version}${progress(pct)}…`,
      getting: "Récupération de la mise à jour…",
      cannot: "Cette copie de MVP ne peut pas se mettre à jour\u00A0: installez la dernière version.",
      failed: (message: string) => `Impossible de récupérer la mise à jour\u00A0: ${message}.`,
      check: "Rechercher la mise à jour",
    },
  },

  notices: {
    label: "Annonces",
    moreInfo: "En savoir plus",
    ready: (mandatory: boolean) => (mandatory ? "Mise à jour importante prête" : "Mise à jour prête"),
    readyText: "s’installe quand vous redémarrez, ou quand vous quittez.",
    restart: "Redémarrer",
    later: "Plus tard",
  },
} satisfies ViewMessages;

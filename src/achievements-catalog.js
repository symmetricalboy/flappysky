/**
 * Canonical Flappysky Open Gaming Catalog (shared by client game UI and server ATProto authority).
 * Namespace: games.opengaming.* -> games.atmosphere.*
 */

export const FLAPPYSKY_GAME_RKEY = 'flappysky';
export const FLAPPYSKY_LEADERBOARD_RKEY = 'high-score';

/**
 * All 14 Flappysky Achievements (XP-free, per-game appreciation model).
 */
export const FLAPPYSKY_ACHIEVEMENTS = [
  {
    id: 'first-flight',
    title: 'First Flight',
    description: 'Completed your very first flight through the Blue Sky.',
    requirement: 'Play your first game of Flappysky.',
    tier: 'bronze',
    hidden: false,
    listOrder: 10,
    iconPath: '/assets/achievements/first-flight.svg',
    iconAlt: 'A bright blue butterfly lifting off above sunlit clouds.',
    palette: { bg1: [14, 116, 240], bg2: [56, 189, 248], accent: [255, 255, 255], motif: 'butterfly' }
  },
  {
    id: 'play-10',
    title: 'Sky Regular',
    description: 'Took to the skies 10 times across your Flappysky sessions.',
    requirement: 'Play 10 games of Flappysky.',
    tier: 'bronze',
    hidden: false,
    stepsNeeded: 10,
    statKey: 'gamesPlayed',
    listOrder: 20,
    iconPath: '/assets/achievements/play-10.svg',
    iconAlt: 'A blue butterfly circling a sky milestone badge marked 10.',
    palette: { bg1: [3, 105, 161], bg2: [14, 165, 233], accent: [253, 186, 116], motif: 'wings' }
  },
  {
    id: 'play-50',
    title: 'Frequent Flyer',
    description: 'Logged 50 flights weaving between blue posts.',
    requirement: 'Play 50 games of Flappysky.',
    tier: 'silver',
    hidden: false,
    stepsNeeded: 50,
    statKey: 'gamesPlayed',
    listOrder: 30,
    iconPath: '/assets/achievements/play-50.svg',
    iconAlt: 'Silver aviator wings framing a butterfly badge marked 50.',
    palette: { bg1: [30, 58, 138], bg2: [59, 130, 246], accent: [226, 232, 240], motif: 'wings' }
  },
  {
    id: 'play-100',
    title: 'Sky Centurion',
    description: 'Completed 100 flights without ever losing your love for the breeze.',
    requirement: 'Play 100 games of Flappysky.',
    tier: 'gold',
    hidden: false,
    stepsNeeded: 100,
    statKey: 'gamesPlayed',
    listOrder: 40,
    iconPath: '/assets/achievements/play-100.svg',
    iconAlt: 'Golden laurel wreath surrounding a soaring butterfly and 100 crest.',
    palette: { bg1: [120, 53, 15], bg2: [217, 119, 6], accent: [254, 240, 138], motif: 'crown' }
  },
  {
    id: 'score-50',
    title: 'Rising Thread',
    description: 'Reached a score of 50 or more in a single flight.',
    requirement: 'Get a score of 50 or more in one game.',
    tier: 'bronze',
    hidden: false,
    listOrder: 50,
    iconPath: '/assets/achievements/score-50.svg',
    iconAlt: 'Bronze starburst rising between two blue posts labeled 50+.',
    palette: { bg1: [124, 45, 18], bg2: [234, 88, 12], accent: [254, 215, 170], motif: 'star' }
  },
  {
    id: 'score-100',
    title: 'Triple-Digit Skeeter',
    description: 'Broke into triple digits with a score of 100 or more in a single flight.',
    requirement: 'Score 100 or more in one game.',
    tier: 'silver',
    hidden: false,
    listOrder: 60,
    iconPath: '/assets/achievements/score-100.svg',
    iconAlt: 'Silver lightning crest gleaming above blue sky pillars labeled 100+.',
    palette: { bg1: [15, 23, 42], bg2: [71, 85, 105], accent: [125, 211, 252], motif: 'bolt' }
  },
  {
    id: 'score-250',
    title: 'Lord of the Stratosphere',
    description: 'Mastered the upper atmosphere with an astonishing score of 250 or more in one run.',
    requirement: 'Score 250 or more in one game.',
    tier: 'platinum',
    hidden: false,
    listOrder: 70,
    iconPath: '/assets/achievements/score-250.svg',
    iconAlt: 'Iridescent platinum crown and aurora halo above a diamond butterfly labeled 250+.',
    palette: { bg1: [49, 46, 129], bg2: [6, 182, 212], accent: [240, 249, 255], motif: 'crown' }
  },
  {
    id: 'likes-50',
    title: 'Warm Reception',
    description: 'Collected 50 floating heart Likes across multiple game sessions.',
    requirement: 'Collect 50 Likes total across all games.',
    tier: 'bronze',
    hidden: false,
    stepsNeeded: 50,
    statKey: 'totalLikes',
    listOrder: 80,
    iconPath: '/assets/achievements/likes-50.svg',
    iconAlt: 'Glowing crimson heart with sparkles and a 50 ribbon.',
    palette: { bg1: [136, 19, 55], bg2: [244, 63, 94], accent: [255, 228, 230], motif: 'heart' }
  },
  {
    id: 'likes-100',
    title: 'Certified Banger',
    description: 'Gathered 100 floating heart Likes across multiple game sessions.',
    requirement: 'Collect 100 Likes total across all games.',
    tier: 'silver',
    hidden: false,
    stepsNeeded: 100,
    statKey: 'totalLikes',
    listOrder: 90,
    iconPath: '/assets/achievements/likes-100.svg',
    iconAlt: 'Twin crimson hearts with silver wings and a 100 badge.',
    palette: { bg1: [159, 18, 57], bg2: [225, 29, 72], accent: [226, 232, 240], motif: 'heart' }
  },
  {
    id: 'likes-250',
    title: 'Main Character',
    description: 'Amassed 250 total floating heart Likes across the Blue Sky.',
    requirement: 'Collect 250 Likes total across all games.',
    tier: 'gold',
    hidden: false,
    stepsNeeded: 250,
    statKey: 'totalLikes',
    listOrder: 100,
    iconPath: '/assets/achievements/likes-250.svg',
    iconAlt: 'Golden-crowned ruby heart radiating sparkles with a 250 crest.',
    palette: { bg1: [127, 29, 29], bg2: [239, 68, 68], accent: [253, 224, 71], motif: 'heart' }
  },
  {
    id: 'play-desktop',
    title: 'Keyboard Aviator',
    description: 'Piloted the butterfly from a desktop or laptop setup.',
    requirement: 'Play Flappysky on desktop.',
    tier: 'bronze',
    hidden: false,
    listOrder: 110,
    iconPath: '/assets/achievements/play-desktop.svg',
    iconAlt: 'Widescreen desktop monitor and glowing spacebar with a blue butterfly.',
    palette: { bg1: [12, 74, 110], bg2: [2, 132, 199], accent: [186, 230, 253], motif: 'desktop' }
  },
  {
    id: 'play-mobile',
    title: 'Pocket Butterfly',
    description: 'Spread your wings in fullscreen landscape on a mobile device.',
    requirement: 'Play Flappysky on mobile.',
    tier: 'bronze',
    hidden: false,
    listOrder: 120,
    iconPath: '/assets/achievements/play-mobile.svg',
    iconAlt: 'Landscape smartphone displaying a blue sky and fluttering butterfly.',
    palette: { bg1: [30, 64, 175], bg2: [56, 189, 248], accent: [224, 242, 254], motif: 'mobile' }
  },
  {
    id: 'ratioed-by-love',
    title: 'Heart Over Hurdles',
    description: 'Finished a game with more Likes contributing to your total score than Posts cleared.',
    requirement: 'Finish a game with strictly more Likes collected than Posts cleared.',
    tier: 'gold',
    hidden: false,
    listOrder: 130,
    iconPath: '/assets/achievements/ratioed-by-love.svg',
    iconAlt: 'Golden balance scale tipping toward a red heart outweighing a blue post.',
    palette: { bg1: [88, 28, 135], bg2: [219, 39, 119], accent: [253, 224, 71], motif: 'scale' }
  },
  {
    id: 'touch-grass',
    title: 'Touch Grass',
    description: 'Bonked straight into the ground without clearing a single post.',
    requirement: 'Bonk straight into the ground with 0 Posts cleared.',
    tier: 'bronze',
    hidden: true,
    listOrder: 140,
    iconPath: '/assets/achievements/touch-grass.svg',
    iconAlt: 'Emerald badge with fresh green grass blades.',
    palette: { bg1: [5, 46, 22], bg2: [22, 101, 52], accent: [134, 239, 172], motif: 'grass' }
  }
];

export const FLAPPYSKY_LEADERBOARD = {
  id: FLAPPYSKY_LEADERBOARD_RKEY,
  name: 'All-Time Best Score',
  description: 'All-time highest single-game score in Flappysky combining Posts cleared (+1) and Likes collected (+1).',
  iconPath: '/assets/achievements/high-score.svg',
  iconAlt: 'A golden arcade trophy crown floating above blue sky clouds.',
  sortOrder: 'largerIsBetter',
  scoreFormat: {
    kind: 'numeric',
    decimalPlaces: 0,
    unitSingular: 'pt',
    unitPlural: 'pts'
  },
  timeframes: ['allTime'],
  recordPolicy: 'bestOnly',
  scoreMin: 1,
  scoreMax: 9999,
  listOrder: 1,
  palette: { bg1: [7, 38, 84], bg2: [0, 133, 255], accent: [251, 191, 36], motif: 'crown' }
};

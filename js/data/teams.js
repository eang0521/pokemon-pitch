// The 8 regional AI teams (13-card rosters).
// Rosters use the card format from js/roster.js: 'slug', or 'slug:POS' for FLEX / SUB slots.
// The FLEX sets the formation: DEF = 3-2-1, MID = 2-3-1, FWD = 2-2-2.
import { coach } from './coaches.js';
export { COACH_PRESETS } from './coaches.js';

export const TEAMS = [
  {
    id: 'kanto', city: 'Kanto', name: 'Kings', abbr: 'KAN',
    colors: { primary: '#c62828', secondary: '#f9c74f' },
    coach: coach('Coach Oak', 'balanced'),
    roster: {GK: 'moltres', DEF1: 'dragonite', DEF2: 'mew', MID1: 'zapdos', MID2: 'exeggutor', FWD: 'arcanine', FLEX: 'vaporeon:MID', bGK: 'jolteon', bDEF: 'articuno', bMID: 'lapras', bFWD: 'magmar', SUB1: 'vileplume:MID', SUB2: 'gyarados:DEF'},
  },
  {
    id: 'johto', city: 'Johto', name: 'Jets', abbr: 'JOH',
    colors: { primary: '#1e88e5', secondary: '#cfd8dc' },
    coach: coach('Coach Elm', 'counter'),
    roster: {GK: 'raikou', DEF1: 'tyranitar', DEF2: 'celebi', MID1: 'suicune', MID2: 'ampharos', FWD: 'entei', FLEX: 'espeon:FWD', bGK: 'crobat', bDEF: 'feraligatr', bMID: 'porygon2', bFWD: 'houndoom', SUB1: 'politoed:MID', SUB2: 'umbreon:DEF'},
  },
  {
    id: 'hoenn', city: 'Hoenn', name: 'Hurricanes', abbr: 'HOE',
    colors: { primary: '#00897b', secondary: '#1a237e' },
    coach: coach('Coach Birch', 'wingPlay'),
    roster: {GK: 'latios', DEF1: 'metagross', DEF2: 'registeel', MID1: 'latias', MID2: 'regice', FWD: 'deoxys', FLEX: 'gardevoir:MID', bGK: 'sceptile', bDEF: 'jirachi', bMID: 'salamence', bFWD: 'blaziken', SUB1: 'walrein:MID', SUB2: 'regirock:DEF'},
  },
  {
    id: 'sinnoh', city: 'Sinnoh', name: 'Blizzard', abbr: 'SIN',
    colors: { primary: '#263238', secondary: '#81d4fa' },
    coach: coach('Coach Rowan', 'parkBus'),
    roster: {GK: 'darkrai', DEF1: 'garchomp', DEF2: 'uxie', MID1: 'heatran', MID2: 'togekiss', FWD: 'azelf', FLEX: 'mesprit:DEF', bGK: 'infernape', bDEF: 'manaphy', bMID: 'magnezone', bFWD: 'magmortar', SUB1: 'glaceon:MID', SUB2: 'shaymin:DEF'},
  },
  {
    id: 'unova', city: 'Unova', name: 'Volts', abbr: 'UNO',
    colors: { primary: '#fdd835', secondary: '#212121' },
    coach: coach('Coach Juniper', 'highPress'),
    roster: {GK: 'hydreigon', DEF1: 'victini', DEF2: 'terrakion', MID1: 'meloetta', MID2: 'keldeo', FWD: 'genesect', FLEX: 'tornadus:FWD', bGK: 'cobalion', bDEF: 'virizion', bMID: 'vanilluxe', bFWD: 'thundurus', SUB1: 'landorus:MID', SUB2: 'haxorus:DEF'},
  },
  {
    id: 'kalos', city: 'Kalos', name: 'Royals', abbr: 'KAL',
    colors: { primary: '#6a1b9a', secondary: '#f48fb1' },
    coach: coach('Coach Sycamore', 'possession'),
    roster: {GK: 'zygarde', DEF1: 'diancie', DEF2: 'goodra', MID1: 'hoopa', MID2: 'volcanion', FWD: 'delphox', FLEX: 'florges:MID', bGK: 'noivern', bDEF: 'chesnaught', bMID: 'sylveon', bFWD: 'greninja', SUB1: 'gogoat:MID', SUB2: 'aegislash:DEF'},
  },
  {
    id: 'alola', city: 'Alola', name: 'Tides', abbr: 'ALO',
    colors: { primary: '#ef6c00', secondary: '#4dd0e1' },
    coach: coach('Coach Kukui', 'counter'),
    roster: {GK: 'zeraora', DEF1: 'kommo-o', DEF2: 'marshadow', MID1: 'magearna', MID2: 'nihilego', FWD: 'pheromosa', FLEX: 'blacephalon:FWD', bGK: 'naganadel', bDEF: 'tapu-bulu', bMID: 'necrozma', bFWD: 'tapu-lele', SUB1: 'primarina:MID', SUB2: 'melmetal:DEF'},
  },
  {
    id: 'galar', city: 'Galar', name: 'Gales', abbr: 'GAL',
    colors: { primary: '#8e1b3a', secondary: '#ffca28' },
    coach: coach('Coach Magnolia', 'longBall'),
    roster: {GK: 'dragapult', DEF1: 'zarude', DEF2: 'glastrier', MID1: 'cursola', MID2: 'spectrier', FWD: 'enamorus', FLEX: 'ursaluna:DEF', bGK: 'inteleon', bDEF: 'urshifu', bMID: 'polteageist', bFWD: 'toxtricity', SUB1: 'hatterene:MID', SUB2: 'rillaboom:DEF'},
  },
];

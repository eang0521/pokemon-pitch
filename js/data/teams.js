// The 8 regional AI teams (13-card rosters), hand-picked from each region's Pokédex
// (no legendaries or mythicals), each with a coach whose style suits the squad.
// Rosters use the card format from js/roster.js: 'slug', or 'slug:POS' for FLEX / SUB slots.
// The FLEX sets the formation: DEF = 3-2-1, MID = 2-3-1, FWD = 2-2-2.
import { coach } from './coaches.js';
export { COACH_PRESETS } from './coaches.js';

export const TEAMS = [
  {
    id: 'kanto', city: 'Kanto', name: 'Kings', abbr: 'KAN',
    colors: { primary: '#c62828', secondary: '#f9c74f' },
    coach: coach('Coach Oak', 'balanced'),
    roster: {
      GK: 'starmie', DEF1: 'gyarados', DEF2: 'machamp', MID1: 'vaporeon', MID2: 'exeggutor', FWD: 'charizard', FLEX: 'dragonite:MID',
      bGK: 'cloyster', bDEF: 'blastoise', bMID: 'venusaur', bFWD: 'jolteon', SUB1: 'arcanine:FWD', SUB2: 'scyther:DEF',
    },
  },
  {
    id: 'johto', city: 'Johto', name: 'Jets', abbr: 'JOH',
    colors: { primary: '#1e88e5', secondary: '#cfd8dc' },
    coach: coach('Coach Elm', 'longBall'),
    roster: {
      GK: 'crobat', DEF1: 'tyranitar', DEF2: 'scizor', MID1: 'espeon', MID2: 'ampharos', FWD: 'typhlosion', FLEX: 'houndoom:FWD',
      bGK: 'xatu', bDEF: 'heracross', bMID: 'kingdra', bFWD: 'feraligatr', SUB1: 'umbreon:DEF', SUB2: 'meganium:MID',
    },
  },
  {
    id: 'hoenn', city: 'Hoenn', name: 'Hurricanes', abbr: 'HOE',
    colors: { primary: '#00897b', secondary: '#1a237e' },
    coach: coach('Coach Birch', 'wingPlay'),
    roster: {
      GK: 'milotic', DEF1: 'metagross', DEF2: 'swampert', MID1: 'gardevoir', MID2: 'walrein', FWD: 'salamence', FLEX: 'blaziken:MID',
      bGK: 'claydol', bDEF: 'aggron', bMID: 'ludicolo', bFWD: 'sceptile', SUB1: 'flygon:FWD', SUB2: 'manectric:FWD',
    },
  },
  {
    id: 'sinnoh', city: 'Sinnoh', name: 'Blizzard', abbr: 'SIN',
    colors: { primary: '#263238', secondary: '#81d4fa' },
    coach: coach('Coach Rowan', 'parkBus'),
    roster: {
      GK: 'glaceon', DEF1: 'garchomp', DEF2: 'dusknoir', MID1: 'togekiss', MID2: 'magnezone', FWD: 'lucario', FLEX: 'gallade:DEF',
      bGK: 'yanmega', bDEF: 'weavile', bMID: 'roserade', bFWD: 'infernape', SUB1: 'electivire:FWD', SUB2: 'empoleon:MID',
    },
  },
  {
    id: 'unova', city: 'Unova', name: 'Volts', abbr: 'UNO',
    colors: { primary: '#fdd835', secondary: '#212121' },
    coach: { ...coach('Coach Juniper', 'highPress'), press: 0.65 },
    roster: {
      GK: 'chandelure', DEF1: 'haxorus', DEF2: 'krookodile', MID1: 'volcarona', MID2: 'reuniclus', FWD: 'zoroark', FLEX: 'mienshao:FWD',
      bGK: 'vanilluxe', bDEF: 'excadrill', bMID: 'samurott', bFWD: 'hydreigon', SUB1: 'eelektross:MID', SUB2: 'serperior:DEF',
    },
  },
  {
    id: 'kalos', city: 'Kalos', name: 'Royals', abbr: 'KAL',
    colors: { primary: '#6a1b9a', secondary: '#f48fb1' },
    coach: coach('Coach Sycamore', 'possession'),
    roster: {
      GK: 'delphox', DEF1: 'goodra', DEF2: 'chesnaught', MID1: 'florges', MID2: 'sylveon', FWD: 'greninja', FLEX: 'noivern:MID',
      bGK: 'hawlucha', bDEF: 'aegislash', bMID: 'gogoat', bFWD: 'pyroar', SUB1: 'talonflame:FWD', SUB2: 'tyrantrum:DEF',
    },
  },
  {
    id: 'alola', city: 'Alola', name: 'Tides', abbr: 'ALO',
    colors: { primary: '#ef6c00', secondary: '#4dd0e1' },
    coach: { ...coach('Coach Kukui', 'balanced'), style: 'Island Style', tempo: 0.6, width: 0.6 },
    roster: {
      GK: 'salazzle', DEF1: 'golisopod', DEF2: 'tsareena', MID1: 'primarina', MID2: 'drampa', FWD: 'kommo-o', FLEX: 'decidueye:FWD',
      bGK: 'ribombee', bDEF: 'dhelmise', bMID: 'vikavolt', bFWD: 'lycanroc', SUB1: 'incineroar:DEF', SUB2: 'mimikyu:MID',
    },
  },
  {
    id: 'galar', city: 'Galar', name: 'Gales', abbr: 'GAL',
    colors: { primary: '#8e1b3a', secondary: '#ffca28' },
    coach: { ...coach('Coach Leon', 'balanced'), style: 'Champion Time', tempo: 0.65, width: 0.6, shootRange: 0.6 },
    roster: {
      GK: 'duraludon', DEF1: 'sirfetchd', DEF2: 'rillaboom', MID1: 'inteleon', MID2: 'hatterene', FWD: 'dragapult', FLEX: 'polteageist:MID',
      bGK: 'boltund', bDEF: 'obstagoon', bMID: 'mr-rime', bFWD: 'cinderace', SUB1: 'toxtricity:FWD', SUB2: 'grimmsnarl:DEF',
    },
  },
];

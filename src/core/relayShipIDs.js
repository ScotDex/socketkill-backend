// Note for anyone, if I am missing any let me know :)

const TITAN_SHIP_IDS = new Set([
        671,
        3764,
        11567,
        23773,
        42126,
        42241,
        45649,
        78576
]);


const SUPER_SHIP_IDS = new Set([
        3514,
        3628,
        22852,
        23913,
        23917,
        23919,
        42125
    
]);

const DREAD_SHIP_IDS = new Set([
        19720,
        19722,
        19724,
        19726,
        34339,
        34341,
        34343,
        34345,
        42124,
        42243,
        45647,
        52907,
        73787,
        73790,
        73792,
        73793,
        87381
]);


const TRIGLAVIAN_SYSTEMS = new Set([
    30000021, // Kuharah
    30000157, // Otela
    30000192, // Otanuomi
    30000206, // Wirashoda
    30001372, // Kino
    30001381, // Arvasaras
    30001413, // Nani
    30001445, // Nalvula
    30002079, // Krirald
    30002225, // Harva
    30002411, // Skarkon
    30002652, // Ala
    30002702, // Archee
    30002737, // Konola
    30002770, // Tunudan
    30002797, // Kaunokka
    30003046, // Angymonne
    30003495, // Raravoss
    30003504, // Niarja
    30005005, // Ignebaener
    30005029, // Vale
    30010141, // Sakenta
    30020141, // Senda
    30031392, // Komo
    30040141, // Urhinichi
    30045328, // Ahtila
    30045329, // Ichoriya
    32000058, // Ubbcre
    32000012, // Xnfcre
    32000049, // Xevfgvaa
    32000123, // Orethe
    32000074, // Rhna
    32000102, // Unsfgrvaa
]);

module.exports = { TITAN_SHIP_IDS, SUPER_SHIP_IDS, TRIGLAVIAN_SYSTEMS, DREAD_SHIP_IDS };
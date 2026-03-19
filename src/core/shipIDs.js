// Note for anyone, if I am missing any let me know :)

const AT_SHIP_IDS = new Set([
    60765, // Raiju
    77726, // Cybele
    45530, // Virtuoso
    48636, // Hydra
    48635, // Tiamat
    33395, // Moracha
    33397, // Chremoas
    3516,  // Malice
    3518,  // Vangel
    32207, // Freki
    32209, // Mimir
    2834,  // Utu
    32790, // Etana
    2836,  // Adrestia
    60764, // Laelaps
    35779, // Imp
    89807, // Anhinga
    32788, // Cambion
    42246, // Caedes
    85229, // Cobra
    35781, // Fiend
    42245, // Rabisu
    85062, // Sidewinder
    11942, // Silver Magnate
    33673, // Whiptail
    11940, // Gold Magnate
    74141, // Geri
    // 29990, // Loki - Test
]);


const OFFICER_SHIP_IDS = new Set([
    // Sansha's Nation
    13609, 13615, 13622, 13635,
    // Rogue Drone
    32959, 32960, 32961, 32962,
    // Angel Cartel
    13536, 13538, 13541, 13544,
    // Guristas
    13580, 13584, 13589, 13603,
    // Blood Raiders
    13557, 13561, 13564, 13573,
    // Serpentis
    13654, 13659, 13661, 13667
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
]);

module.exports = { AT_SHIP_IDS, OFFICER_SHIP_IDS, TRIGLAVIAN_SYSTEMS };
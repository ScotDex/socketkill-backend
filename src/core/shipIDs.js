// force rebuild note

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
    85236, // Python
    33675, // Chameleon
    11011, // Guardian Vexor
    78414, // Shapash
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

const RORQUAL_SHIP_IDS = new Set([
    42241, // Molok
    33675 // Chameleon
]);


module.exports = { AT_SHIP_IDS, OFFICER_SHIP_IDS, RORQUAL_SHIP_IDS };
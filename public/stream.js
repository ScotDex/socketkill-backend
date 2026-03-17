const socket = io();
const feed = document.getElementById('feed');
const status = document.getElementById('status');
const counterElement = document.getElementById('kill-counter');
const regionSearch = document.getElementById('regionSearch');

const MAX_FEED_SIZE = 60;
let isTyping = false;
let regionCache = [];

function formatIskShorthand(value) {
    if (value >= 1e12) return (value / 1e12).toFixed(2) + "T";
    if (value >= 1e9)  return (value / 1e9).toFixed(2) + "B";
    if (value >= 1e6)  return (value / 1e6).toFixed(1) + "M";
    return value.toLocaleString();
}

// === COUNTER SURGE EFFECT ===
function counterSurge() {
    const counter = document.getElementById('kill-counter');
    
    gsap.timeline()
        .to(counter, {
            duration: 0.2,
            scale: 1.5,
            textShadow: `
                0 0 5px #fff,
                0 0 10px #3fb950,
                0 0 20px #3fb950,
                0 0 40px #3fb950
            `,
            ease: 'back.out(2)'
        })
        .to(counter, {
            duration: 0.3,
            scale: 1,
            textShadow: '0 0 8px rgba(63, 185, 80, 0.6)',
            ease: 'power2.out'
        });
}

const formatIskValue = (value) => {
    const num = Number(value);
    if (num >= 1000000000) return (num / 1000000000).toFixed(2) + "B";
    return (num / 1000000).toFixed(2) + "M";
};

(function() {
    const banner = document.getElementById('awards-banner');
    const dismissBtn = document.getElementById('dismiss-banner');
    const storageKey = 'creator-awards-banner-dismissed';
    
    // Check if user already dismissed
    if (!localStorage.getItem(storageKey)) {
        banner.style.display = 'block';
        document.body.classList.add('awards-banner-visible');
    }
    
    // Dismiss permanently
    dismissBtn?.addEventListener('click', () => {
        localStorage.setItem(storageKey, 'true');
        banner.style.display = 'none';
        document.body.classList.remove('awards-banner-visible');
    });
})();

function typeBootSequence() {
    const bootLines = [
        '> INITIALIZING GRID MONITOR...',
        '> CONNECTING TO ESI DATASOURCE...',
        '> PARSING ZKILLBOARD STREAM...',
        '> UPLINK ESTABLISHED',
        '> AWAITING KILL DATA'
    ];
    const bootDisplay = document.querySelector('.boot-sequence');
    if (!bootDisplay) return;

    bootDisplay.innerHTML = '';
    let lineIndex = 0;
    let charIndex = 0;

    function typeChar() {
        if (lineIndex < bootLines.length) {
            if (charIndex < bootLines[lineIndex].length) {
                bootDisplay.innerHTML += bootLines[lineIndex][charIndex];
                charIndex++;
                setTimeout(typeChar, 30);
            } else {
                bootDisplay.innerHTML += '<br>';
                lineIndex++;
                charIndex = 0;
                if (lineIndex < bootLines.length) {
                    setTimeout(typeChar, 200);
                } else {
                    bootDisplay.innerHTML += '<span class="dot-pulse"></span>';
                }
            }
        }
    }
    typeChar();
}

const typeTitle = (elementId, text, speed = 150) => {
    if (isTyping) return;
    isTyping = true;
    const element = document.getElementById(elementId);
    if (!element) return;
    element.innerHTML = "";
    let i = 0;
function type() {
    if (i < text.length) {
        const span = document.createElement('span');
        span.className = 'char-flash';
        span.textContent = text.charAt(i);
        element.appendChild(span);
        i++;
        setTimeout(type, speed);
    } else {
        element.style.borderRight = "none";
    }
}
    type();
};

const renderShipName = (el, text) => {
    el.innerText = text;
    el.animate([
        { opacity: 0, filter: 'brightness(3)' },
        { opacity: 1, filter: 'brightness(1)' }
    ], { duration: 200, easing: 'ease-out' });
};

const typeShipNameSurgical = (el, text) => {
    if (document.hidden) {
        el.innerText = text;
        return;
    }
    let i = 0;
    const startTime = performance.now();
    el.classList.add('typewriter-cursor');
    const render = () => {
        if (i < text.length) {
            if (Math.floor((performance.now() - startTime) / 100) > i) {
                el.innerText += text[i];
                i++;
            }
            requestAnimationFrame(render);
        } else {
            setTimeout(() => el.classList.remove('typewriter-cursor'), 2000);
        }
    };
    render();
};

// Terminal Autocomplete
let selectedIndex = -1;



function showSuggestions(term) {
    const dropdown = document.getElementById('region-suggestions');
    const matches = regionCache
        .filter(r => r.toLowerCase().includes(term))
        .slice(0, 6);

    if (matches.length === 0 || term.length < 2) {
        dropdown.classList.remove('active');
        selectedIndex = -1;
        return;
    }

    dropdown.innerHTML = matches.map((region, idx) => 
        `<div class="suggestion-item" data-region="${region}" data-idx="${idx}">${region}</div>`
    ).join('');

    dropdown.classList.add('active');
    selectedIndex = -1;

    // Click handler for suggestions
    dropdown.querySelectorAll('.suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
            regionSearch.value = item.dataset.region;
            dropdown.classList.remove('active');
            regionSearch.dispatchEvent(new Event('input'));
            regionSearch.focus();
        });
    });
}

function selectSuggestion(direction) {
    const dropdown = document.getElementById('region-suggestions');
    const items = dropdown.querySelectorAll('.suggestion-item');
    if (items.length === 0) return;

    // Remove previous selection
    items.forEach(item => item.classList.remove('selected'));

    // Update index
    if (direction === 'down') {
        selectedIndex = (selectedIndex + 1) % items.length;
    } else if (direction === 'up') {
        selectedIndex = selectedIndex <= 0 ? items.length - 1 : selectedIndex - 1;
    }

    // Apply new selection
    items[selectedIndex].classList.add('selected');
    items[selectedIndex].scrollIntoView({ block: 'nearest' });
}

function selectCurrentSuggestion() {
    const dropdown = document.getElementById('region-suggestions');
    const selected = dropdown.querySelector('.suggestion-item.selected');
    if (selected) {
        regionSearch.value = selected.dataset.region;
        dropdown.classList.remove('active');
        regionSearch.dispatchEvent(new Event('input'));
    }
}

// Input handler
regionSearch.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    const header = document.querySelector('.terminal-header');
    const filterLabel = document.getElementById('active-filter-label');

    header.classList.toggle('filter-active', term !== '');
    filterLabel.innerText = term ? `// FILTERING: ${term.toUpperCase()}` : '';
    filterLabel.classList.toggle('active', term !== '');
    
    // Filter kill rows
    const rows = document.querySelectorAll('.kill-row');
    rows.forEach(row => {
        const locationText = row.querySelector('.location-label')?.textContent.toLowerCase() || "";
        row.hidden = term !== "" && !locationText.includes(term);
    });

    const exactMatch = regionCache.some (r => r.toLowerCase() === term);
    if (exactMatch) {
        document.getElementById('region-suggestions').classList.remove('active');
        return;
    }


    // Show suggestions
    showSuggestions(term);
});

// Keyboard navigation
regionSearch.addEventListener('keydown', (e) => {
    const dropdown = document.getElementById('region-suggestions');
    if (!dropdown.classList.contains('active')) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectSuggestion('down');
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectSuggestion('up');
    } else if (e.key === 'Enter') {
        e.preventDefault();
        selectCurrentSuggestion();
    } else if (e.key === 'Escape') {
        dropdown.classList.remove('active');
        selectedIndex = -1;
    }
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.terminal-input-wrapper')) {
        document.getElementById('region-suggestions').classList.remove('active');
        selectedIndex = -1;
    }
});


socket.on('connect', () => {
    status.innerText = "ONLINE";
    status.className = "badge bg-success";
});

socket.on('disconnect', () => {
    status.innerText = "OFFLINE";
    status.className = "badge bg-danger";
});

socket.on('region-list', (regionNames) => {
    regionCache = regionNames;
});

socket.on('gatekeeper-stats', (data) => {
    if (counterElement && data.totalScanned) {
        counterElement.innerText = data.totalScanned.toLocaleString();
        counterElement.classList.remove('counter-update');
        void counterElement.offsetWidth;
        counterElement.classList.add('counter-update');
        counterSurge(); 
    }
    if (data.totalIsk) {
        const headerIsk = document.getElementById("isk-ticker-header");
        if (headerIsk) headerIsk.innerText = formatIskShorthand(data.totalIsk);
    }
});

socket.on('player-count', (data) => {
    const headerPlayers = document.getElementById('player-count-header');
    if (data && data.active) {
        if (headerPlayers) headerPlayers.innerText = data.count.toLocaleString();
    } else {
        if (headerPlayers) headerPlayers.innerText = "OFFLINE";
    }
});

socket.on('nebula-update', (data) => {
    if (data && data.url) {
        const tempImg = new Image();
        tempImg.src = data.url;
        tempImg.onload = () => {
            document.body.style.backgroundImage = `linear-gradient(rgba(13, 17, 23, 0.8), rgba(13, 17, 23, 0.8)), url('${data.url}')`;
            document.body.style.backgroundSize = 'cover';
            document.body.style.backgroundAttachment = 'fixed';
            document.body.style.backgroundPosition = 'center';
        };
    }
});

socket.on('raw-kill', (kill) => {
    const val = Number(kill.val) || 0;
    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.remove();

    if (counterElement && kill.totalScanned) {
        counterElement.innerText = kill.totalScanned.toLocaleString();
        counterElement.classList.remove('counter-update');
        void counterElement.offsetWidth;
        counterElement.classList.add('counter-update');
        counterSurge(); 
    }

    const div = document.createElement('div');
    div.className = `kill-row justify-content-between ${val >= 10000000000 ? 'whale' : ''}`;
    if (val >= 10000000000) {
        document.body.classList.add('signal-interference');
        setTimeout(() => document.body.classList.remove('signal-interference'), 400);
    }

    const now = new Date();
    const timestamp = `[${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')}]`;
    // Covering for NPC and Corp complications
    const victimDisplay = kill.victimName === kill.corpName
        ? kill.victimName
        : `${kill.victimName} of ${kill.corpName}`;


div.innerHTML = `
    <div class="d-flex align-items-center" style="flex: 1;">
        <div class="ship-icon-container">
            <img src="${kill.shipImageUrl}" alt="Ship Render" class="ship-render" loading="lazy">
        </div>
        <div class="kill-info">
            <div><strong class="ship-name">
                <span class="timestamp">${timestamp}</span>
                ${victimDisplay} lost
                <span class="article-target"></span><span class="type-target ship-name-container"></span>
            </strong></div>
            <div class="small">
                <span class="location-label">${kill.locationLabel}</span>
            </div>
        </div>
    </div>
    <div class="kill-meta">
        <span class="final-blow-label">${kill.attackerCount} attackers </span>
    </div>
    <div class="d-flex align-items-center">
        <div class="corp-square-container me-3">
            <img src="${kill.corpImageUrl}" alt="Corporation Logo" class="corp-logo-square" loading="lazy">
        </div>
        <div class="text-end" style="width: 100px;">
            <div class="${val >= 1000000000 ? 'isk-billion' : 'isk-million'} fw-bold">${formatIskValue(val)}</div>
            <a href="${kill.zkillUrl}" target="_blank" rel="noopener" class="zkill-link">REPORT</a>
        </div>
    </div>
`;

    const overlay = document.querySelector('body');
    overlay.style.opacity = '0.9';
    setTimeout(() => overlay.style.opacity = '1', 50);

    if (regionSearch.value.toLowerCase().trim() !== "" && 
        !kill.locationLabel.toLowerCase().includes(regionSearch.value.toLowerCase().trim())) {
        div.hidden = true;
    }

    feed.prepend(div);
    div.querySelector('.article-target').innerText = kill.article || "a";
    renderShipName(div.querySelector('.type-target'), kill.ship);

    gsap.fromTo(div,
    {
        clipPath: 'inset(0 0 100% 0)',
        opacity: 1,
        filter: 'brightness(2)'
    },
    {
        clipPath: 'inset(0 0 0% 0)',
        filter: 'brightness(1)',
        duration: 0.2,
        ease: 'steps(8)'
    }
);
    if (feed.children.length > MAX_FEED_SIZE) {
    const lastRow = feed.lastChild;
    lastRow.classList.add('removing');
    setTimeout(() => lastRow.remove(), 400);
}
});

const updateNPCTicker = async () => {
    const npcDisplay = document.getElementById('npc-count');
    if (!npcDisplay) return;
    try {
        const response = await fetch('https://api.socketkill.com/stats/npc-kills');
        const data = await response.json();
        if (data && data.lifetimeTotal) {
            npcDisplay.innerText = data.lifetimeTotal.toLocaleString();
            npcDisplay.style.opacity = "0.5";
            setTimeout(() => npcDisplay.style.opacity = "1", 200);
        }
    } catch (err) {
        npcDisplay.innerText = "OFFLINE";
        npcDisplay.classList.replace('text-warning', 'text-danger');
    }
};

const initApp = () => {
    typeTitle('socket-title', 'Socket.Kill', 150);
    typeBootSequence();
    updateNPCTicker();
    setInterval(updateNPCTicker, 300000);

    // Network dropdown
    document.getElementById('network-toggle').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('network-dropdown').classList.toggle('active');
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#network-toggle') && !e.target.closest('#network-dropdown')) {
            document.getElementById('network-dropdown').classList.remove('active');
        }
    });
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

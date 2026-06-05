import './GM_fetch.js';
import cleanLink from './link-cleaner.js';

const DISABLED_HOST_KEY_PREFIX = 'disabledHost:';

const getCurrentHostname = () => location.hostname.toLowerCase();

const getCurrentDisabledHostKey = () => {
    const hostname = getCurrentHostname();
    return hostname && DISABLED_HOST_KEY_PREFIX + hostname;
}

const isCurrentHostDisabled = async () => {
    const key = getCurrentDisabledHostKey();
    return !!key && !!await GM.getValue(key, false);
}

const setCurrentHostDisabled = async disabled => {
    const key = getCurrentDisabledHostKey();
    if (!key) return false;
    await GM.setValue(key, !!disabled);
    return true;
}

// 处理<a>标签

/**
 * @param {HTMLAnchorElement} e
 */
const cleanLinkForDOM = e => {
    if (!(e instanceof HTMLAnchorElement) || !e.href) return;
    return cleanLink(e.href)
        .then(t => {
            const r = t.toString()
            if (e.href === r) return;
            console.log('Link cleaner:', e, e.href, '->', (e.href = t.toString()));
        })
        .catch(err => console.warn('Link cleaner:', e, e.href, 'Failed to clean', err));
}

/**
 * @param {Node} e
 */
const cleanLinksForDOM = e => {
    if (e instanceof HTMLAnchorElement) cleanLinkForDOM(e);
    if (e instanceof Element) e.querySelectorAll('a').forEach(cleanLinkForDOM);
}

const cleanSpmAttributes = () => setTimeout(() => [
    ...document.querySelectorAll('[data-spm]'),
    ...document.querySelectorAll('[data-spm-anchor-id]'),
].forEach(e => {
    e.removeAttribute('data-spm');
    e.removeAttribute('data-spm-anchor-id');
}), 1000);

const cleanLocation = (replace = false) => cleanLink(location.href).then(e => {
    const cleaned = e.toString();
    if (cleaned === location.href) return false;
    if (replace) {
        history.replaceState(history.state, '', cleaned);
        return true;
    }
    document.head.innerHTML = '';
    document.body.innerHTML = `<div style="display:flex;height:100vh;flex-direction:column;justify-content:center;align-items:center"><div style="margin:.25em">链接已清洗，即将跳转到以下地址</div><small style="margin:.25em">${e}</small></div>`;
    location.href = cleaned;
    return true;
});

const setupHistoryHook = () => {
    for (const name of ['pushState', 'replaceState']) {
        const fn = history[name];
        history[name] = function () {
            const r = fn.apply(this, arguments);
            setTimeout(() => cleanLocation(true));
            return r;
        }
    }
    addEventListener('popstate', () => setTimeout(() => cleanLocation(true)));
}

const setupMutationObserver = () => {
    // Experimental
    const observerTarget = document.body || document.documentElement;
    if (observerTarget) new MutationObserver(mutationList => {
        for (const mutation of mutationList) {
            cleanLinksForDOM(mutation.target);
            mutation.addedNodes.forEach(cleanLinksForDOM);
        }
    }).observe(observerTarget, {
        attributes: true,
        attributeFilter: ['href'],
        // attributeOldValue: true,
        childList: true,
        subtree: true,
    });
}

const startAutoClean = () => cleanLocation().then(cleaned => {
    if (cleaned) return;

    setupHistoryHook();

    document.querySelectorAll('a').forEach(cleanLinkForDOM);

    setupMutationObserver();
});

// 处理fetch和XMLHttpRequest（使用xhook）
const startXhookIfEnabled = async () => {
    if (!await GM.getValue('xhookEnabled')) return;

    /** @type {String} */
    let xhookScript;
    if (await GM.getValue('xhookCacheBefore', 0) < Date.now() || !(xhookScript = await GM.getValue('xhookCached'))) {
        console.log('Link cleaner:', 'Fetching xhook from jsdelivr ...');
        await GM.setValue('xhookCached', (xhookScript = await fetch('https://cdn.jsdelivr.net/npm/xhook@1/dist/xhook.min.js').then(r => r.text())));
        await GM.setValue('xhookCacheBefore', Date.now() + 6048e5); // 86400 * 7 * 1000
    } else {
        console.log('Link cleaner:', 'Loading xhook from cache ...', 'Expire:', new Date(await GM.getValue('xhookCacheBefore')));
    }
    // Shamefully use eval to run code from string
    (0, unsafeWindow.eval)(xhookScript);
    console.log('Link cleaner:', 'xhook is loaded!');
    unsafeWindow.xhook.before(async (request, callback) => {
        let u = request.url;
        if (typeof u === 'string' && !URL.canParse(u)) {
            u = location.origin + (u.startsWith('/') ? '' : '/') + u;
            console.log(u);
        }
        const r = (await cleanLink(u)).toString();
        if (u.toString() !== r) {
            console.log('Link cleaner:', 'xhook', u.toString(), '->', (request.url = r));
        }
        callback();
    });
}

// 添加右键菜单
const registerMenus = async currentHostDisabled => {
    const hostname = getCurrentHostname();

    GM.registerMenuCommand('手动输入链接进行清洗', async () => {
        if (window.top !== window.self) return;
        const url = prompt('请输入需要清洗的链接：');
        if (!url) return;
        try {
            const cleaned = await cleanLink(url);
            if (cleaned.toString() !== url) {
                confirm('链接已清洗，是否需要复制？\n' + cleaned) && GM.setClipboard(cleaned);
            } else {
                alert('链接无需清洗。');
            }
        } catch (err) {
            alert('链接清洗失败。\n' + err.stack);
        }
    });

    if (hostname) {
        GM.registerMenuCommand((currentHostDisabled ? '重新启用当前网站清洗' : '在当前网站禁用清洗') + `（${hostname}，刷新后生效）`, async () => {
            const disabled = await isCurrentHostDisabled();
            const succeeded = await setCurrentHostDisabled(!disabled);
            if (!succeeded) {
                alert('当前页面不支持按网站禁用清洗。');
                return;
            }
            alert(`已${disabled ? '重新启用' : '在当前网站禁用'}清洗：${hostname}\n刷新后生效。`);
        });
    }

    if (!currentHostDisabled) {
        GM.registerMenuCommand('重新清洗网页上的所有链接', () => document.querySelectorAll('a').forEach(cleanLinkForDOM));
    }
    GM.registerMenuCommand('复制标题和网址', () => {
        if (window.top !== window.self) return;
        const text = `${document.title.trim()}\n${location.href}`;
        GM.setClipboard(text);
        alert(`已复制：\n${text}`);
    });
    GM.registerMenuCommand('复制标题和网址（Markdown）', () => {
        if (window.top !== window.self) return;
        const text = `[${document.title.trim()}](${location.href})`;
        GM.setClipboard(text);
        alert(`已复制：\n${text}`);
    });
    const xhookEnabled = await GM.getValue('xhookEnabled');
    GM.registerMenuCommand('增强清洗模式（xhr/fetch请求，切换后刷新生效）' + (xhookEnabled ? '✅' : '❌'), async () => GM.setValue('xhookEnabled', !xhookEnabled));
}

(async () => {
    const currentHostDisabled = await isCurrentHostDisabled();

    if (currentHostDisabled) {
        console.log('Link cleaner:', 'Disabled on current host:', getCurrentHostname());
    } else {
        cleanSpmAttributes();
        startAutoClean();
        startXhookIfEnabled().catch(err => console.warn('Link cleaner:', 'Failed to load xhook', err));
    }

    await registerMenus(currentHostDisabled);
})()

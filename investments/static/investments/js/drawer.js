(function () {
    var openTrigger = null;

    function getDrawer(id) {
        return document.getElementById(id);
    }

    function openDrawer(id, trigger) {
        var drawer = getDrawer(id);
        if (!drawer) return;

        var overlay = drawer.previousElementSibling;
        openTrigger = trigger || document.activeElement;

        drawer.classList.add('open');
        if (overlay && overlay.classList.contains('drawer-overlay')) {
            overlay.classList.add('open');
        }

        var content = document.querySelector('.page-content');
        if (content) content.inert = true;
        document.body.style.overflow = 'hidden';

        var firstField = drawer.querySelector('input:not([type=hidden]), select, textarea');
        if (firstField) firstField.focus();
    }

    function closeDrawer(drawer) {
        if (!drawer) return;
        var overlay = drawer.previousElementSibling;

        drawer.classList.remove('open');
        if (overlay && overlay.classList.contains('drawer-overlay')) {
            overlay.classList.remove('open');
        }

        var content = document.querySelector('.page-content');
        if (content) content.inert = false;
        document.body.style.overflow = '';

        if (openTrigger && typeof openTrigger.focus === 'function') {
            openTrigger.focus();
        }
        openTrigger = null;
    }

    document.addEventListener('click', function (event) {
        var openBtn = event.target.closest('[data-drawer-open]');
        if (openBtn) {
            openDrawer(openBtn.getAttribute('data-drawer-open'), openBtn);
            return;
        }

        var closeBtn = event.target.closest('[data-drawer-close]');
        if (closeBtn) {
            closeDrawer(closeBtn.closest('.drawer'));
            return;
        }

        if (event.target.classList.contains('drawer-overlay')) {
            var openDrawerEl = document.querySelector('.drawer.open');
            closeDrawer(openDrawerEl);
        }
    });

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            var openDrawerEl = document.querySelector('.drawer.open');
            if (openDrawerEl) closeDrawer(openDrawerEl);
        }
    });
})();

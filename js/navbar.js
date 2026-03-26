"use strict";

const navMenu = document.querySelector('#nav-menu');
const navLinks = navMenu.querySelectorAll('a');

navLinks.forEach(function(link) {
    // If link is a fully disabled nav (active + aria-disabled + disabled), skip all event handling
    if (
        link.classList.contains('active') &&
        link.getAttribute('aria-disabled') === 'true' &&
        link.hasAttribute('disabled')
    ) {
        return;
    }
    link.addEventListener('mouseover', function() {
        navLinks.forEach(function(otherLink) {
            if (
                otherLink.classList.contains('active') &&
                otherLink.getAttribute('aria-disabled') === 'true' &&
                otherLink.hasAttribute('disabled')
            ) {
                // Don't remove active from fully disabled links
                return;
            }
            otherLink.classList.remove('active');
        });
        this.classList.add('active');
    });

    link.addEventListener('mouseout', function() {
        // Only remove if not fully disabled
        if (
            this.classList.contains('active') &&
            this.getAttribute('aria-disabled') === 'true' &&
            this.hasAttribute('disabled')
        ) {
            return;
        }
        this.classList.remove('active');
    });
});

const footerNav = document.querySelector('#footer-nav');
const footerLinks = footerNav.querySelectorAll('a');

footerLinks.forEach(function(link) {
    if (
        link.classList.contains('active') &&
        link.getAttribute('aria-disabled') === 'true' &&
        link.hasAttribute('disabled')
    ) {
        return;
    }
    link.addEventListener('mouseover', function() {
        footerLinks.forEach(function(otherLink) {
            if (
                otherLink.classList.contains('active') &&
                otherLink.getAttribute('aria-disabled') === 'true' &&
                otherLink.hasAttribute('disabled')
            ) {
                return;
            }
            otherLink.classList.remove('active');
        });
        this.classList.add('active');
    });

    link.addEventListener('mouseout', function() {
        if (
            this.classList.contains('active') &&
            this.getAttribute('aria-disabled') === 'true' &&
            this.hasAttribute('disabled')
        ) {
            return;
        }
        this.classList.remove('active');
    });
});

const mobileNavMenu = document.querySelector('.mobile-nav-content');
const mobileNavLinks = mobileNavMenu ? mobileNavMenu.querySelectorAll('a') : [];

mobileNavLinks.forEach(function(link) {
    if (
        link.classList.contains('active') &&
        link.getAttribute('aria-disabled') === 'true' &&
        link.hasAttribute('disabled')
    ) {
        return;
    }
    link.addEventListener('mouseover', function() {
        mobileNavLinks.forEach(function(otherLink) {
            if (
                otherLink.classList.contains('active') &&
                otherLink.getAttribute('aria-disabled') === 'true' &&
                otherLink.hasAttribute('disabled')
            ) {
                return;
            }
            otherLink.classList.remove('active');
        });
        this.classList.add('active');
    });

    link.addEventListener('mouseout', function() {
        if (
            this.classList.contains('active') &&
            this.getAttribute('aria-disabled') === 'true' &&
            this.hasAttribute('disabled')
        ) {
            return;
        }
        this.classList.remove('active');
    });
});

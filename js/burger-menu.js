"use strict";

const burgerMenu = document.querySelector('#header-burger');
const mobileNav = document.querySelector('#mobile-nav');

function setMenuState(isOpen) {
    if (!burgerMenu || !mobileNav) {
        return;
    }

    burgerMenu.classList.toggle('active', isOpen);
    mobileNav.classList.toggle('active', isOpen);
    burgerMenu.setAttribute('aria-expanded', String(isOpen));
}

if (burgerMenu && mobileNav) {
    burgerMenu.addEventListener('click', function() {
        setMenuState(!burgerMenu.classList.contains('active'));
    });

    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && burgerMenu.classList.contains('active')) {
            setMenuState(false);
        }
    });

    mobileNav.addEventListener('click', function(event) {
        if (event.target.matches('a')) {
            setMenuState(false);
        }
    });

    setMenuState(false);
    burgerMenu.setAttribute('aria-label', 'Toggle navigation menu');
}

"use strict";

const burgerMenu = document.querySelector('.header-burger');

burgerMenu.addEventListener('click', function() {
    burgerMenu.classList.toggle('active');

    const isExpanded = burgerMenu.classList.contains('active');
    burgerMenu.setAttribute('aria-expanded', isExpanded);
});

document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape' && burgerMenu.classList.contains('active')) {
        burgerMenu.classList.remove('active');
        burgerMenu.setAttribute('aria-expanded', 'false');
    }
});

burgerMenu.setAttribute('aria-expanded', 'false');
burgerMenu.setAttribute('aria-label', 'Toggle navigation menu');
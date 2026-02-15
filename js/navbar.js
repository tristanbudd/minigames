
const navMenu = document.querySelector('.nav-menu');
const navLinks = navMenu.querySelectorAll('a');

navLinks.forEach(function(link) {
    link.addEventListener('mouseover', function() {
        navLinks.forEach(function(otherLink) {
            otherLink.classList.remove('active');
        });
        this.classList.add('active');
    });

    link.addEventListener('mouseout', function() {
        this.classList.remove('active');
    });
});

const footerNav = document.querySelector('.footer-nav');
const footerLinks = footerNav.querySelectorAll('a');

footerLinks.forEach(function(link) {
    link.addEventListener('mouseover', function() {
        footerLinks.forEach(function(otherLink) {
            otherLink.classList.remove('active');
        });
        this.classList.add('active');
    });

    link.addEventListener('mouseout', function() {
        this.classList.remove('active');
    });
});
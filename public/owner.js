// Owner page: once a download starts, bring the delete card forward; deleting
// takes a second click so a stray tap cannot wipe the drop.

const card = document.getElementById('delete');
const form = document.getElementById('delete-form');
const btn = document.getElementById('delete-btn');

for (const a of document.querySelectorAll('.js-download')) {
  a.addEventListener('click', () => {
    if (!card) return;
    card.classList.add('ready');
    card.querySelector('h2').textContent = 'Got everything?';
    setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'center' }), 400);
  });
}

if (form) {
  let armed = false;
  let timer;
  form.addEventListener('submit', (ev) => {
    if (armed) {
      btn.disabled = true;
      btn.textContent = 'Purging…';
      return;
    }
    ev.preventDefault();
    armed = true;
    btn.textContent = 'Confirm delete';
    btn.classList.add('armed');
    clearTimeout(timer);
    timer = setTimeout(() => {
      armed = false;
      btn.textContent = 'Delete';
      btn.classList.remove('armed');
    }, 4000);
  });
}

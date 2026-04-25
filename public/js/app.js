/* ═══════════════════════════════════════════════════════════
   LeadFlow by Mystic — Frontend Logic
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── State ─────────────────────────────────────────────────
  let currentTab = 'active';
  let allLeads = [];
  let currentUser = null;
  let logsPage = 1;
  let leadsPage = 1;
  let categories = [];
  let deleteCategoryTarget = null;
  let cooldownTimer = null;

  // ─── DOM refs ──────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const leadsList = $('#leads-list');
  const loadingState = $('#loading-state');
  const emptyState = $('#empty-state');
  const searchInput = $('#search-input');
  const logsList = $('#logs-list');
  const logsPagination = $('#logs-pagination');
  const leadsPagination = $('#leads-pagination');
  const logsEmpty = $('#logs-empty');
  const toastContainer = $('#toast-container');

  // ─── Init ──────────────────────────────────────────────────
  async function init() {
    try {
      const res = await fetch('/auth/me');
      if (!res.ok) { window.location.href = '/'; return; }
      const data = await res.json();
      currentUser = data.user;

      $('#user-avatar').src = currentUser.avatar || '';
      $('#user-name').textContent = currentUser.username;
    } catch {
      window.location.href = '/';
      return;
    }

    bindEvents();
    await loadCategories();
    await loadLeads();
  }

  // ─── Event Bindings ────────────────────────────────────────
  function bindEvents() {
    // Sidebar tabs
    $$('.sidebar-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Search
    searchInput.addEventListener('input', debounce(() => { leadsPage = 1; loadLeads(); }, 250));

    // Add lead modal
    $('#add-lead-btn').addEventListener('click', () => openModal('modal-add'));
    $('#modal-add-close').addEventListener('click', () => closeModal('modal-add'));
    $('#add-lead-form').addEventListener('submit', handleAddLead);

    // Edit lead modal
    $('#modal-edit-close').addEventListener('click', () => closeModal('modal-edit'));
    $('#edit-lead-form').addEventListener('submit', handleEditLead);

    // Delete modal
    $('#modal-delete-close').addEventListener('click', () => closeModal('modal-delete'));
    $('#delete-cancel-btn').addEventListener('click', () => closeModal('modal-delete'));

    // Category manager modal
    $('#manage-categories-btn').addEventListener('click', () => { renderCategoryManager(); openModal('modal-categories'); });
    $('#modal-categories-close').addEventListener('click', () => closeModal('modal-categories'));
    $('#add-category-btn').addEventListener('click', handleAddCategory);
    $('#new-category-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAddCategory(); });

    // Delete category modal
    $('#modal-delete-category-close').addEventListener('click', () => closeDeleteCategoryModal());
    $('#delete-category-cancel-btn').addEventListener('click', () => closeDeleteCategoryModal());
    $('#delete-category-confirm-btn').addEventListener('click', () => handleDeleteCategory(false));
    $('#delete-category-with-leads-btn').addEventListener('click', () => handleDeleteCategory(true));

    // Backup
    $('#backup-btn').addEventListener('click', handleBackup);

    // Close modals on overlay click
    $$('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.add('hidden');
          if (overlay.id === 'modal-delete-category') closeDeleteCategoryModal();
        }
      });
    });

    // Event delegation for leads (no inline handlers = no XSS surface)
    leadsList.addEventListener('click', handleLeadsClick);
    leadsList.addEventListener('change', handleLeadsChange);
    leadsList.addEventListener('keydown', handleLeadsKeydown);
    logsPagination.addEventListener('click', handleLogsPaginationClick);
    leadsPagination.addEventListener('click', handleLeadsPaginationClick);

    // Logout via POST (prevents CSRF via GET)
    $('#logout-btn').addEventListener('click', async (e) => {
      e.preventDefault();
      await fetch('/auth/logout', { method: 'POST' });
      window.location.href = '/';
    });
  }

  // ─── Event Delegation Handlers ────────────────────────────
  function handleLeadsClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const { action, id } = target.dataset;
    const lead = allLeads.find(l => l._id === id);
    switch (action) {
      case 'toggle': toggleAccordion(id); break;
      case 'copy': if (lead) copyEmail(lead.email, target); break;
      case 'edit': openEdit(id); break;
      case 'delete': if (lead) openDelete(id, lead.companyName); break;
      case 'add-note': addNote(id); break;
    }
  }

  function handleLeadsChange(e) {
    const target = e.target.closest('[data-action="status"]');
    if (!target) return;
    changeStatus(target.dataset.id, target.value);
  }

  function handleLeadsKeydown(e) {
    if (e.key !== 'Enter') return;
    const target = e.target.closest('[data-action="note-input"]');
    if (!target) return;
    addNote(target.dataset.id);
  }

  function handleLogsPaginationClick(e) {
    const target = e.target.closest('[data-page]');
    if (!target) return;
    logsPage = parseInt(target.dataset.page);
    loadLogs();
  }

  function handleLeadsPaginationClick(e) {
    const target = e.target.closest('[data-page]');
    if (!target) return;
    leadsPage = parseInt(target.dataset.page);
    loadLeads();
  }

  // ─── Tab Switching ─────────────────────────────────────────
  function switchTab(tab) {
    currentTab = tab;
    $$('.sidebar-tab').forEach(t => t.classList.remove('active'));
    $(`.sidebar-tab[data-tab="${tab}"]`).classList.add('active');

    if (tab === 'logs') {
      $('#view-leads').classList.remove('active');
      $('#view-logs').classList.add('active');
      logsPage = 1;
      loadLogs();
    } else {
      $('#view-logs').classList.remove('active');
      $('#view-leads').classList.add('active');

      const titles = { active: 'Leads', blacklisted: 'Blacklisted', accepted: 'Deal Accepted' };
      $('#content-title').textContent = titles[tab] || 'Leads';
      searchInput.value = '';
      leadsPage = 1;
      loadLeads();
    }
  }

  // ─── Load Categories ──────────────────────────────────────
  async function loadCategories() {
    try {
      const res = await fetch('/api/categories');
      if (!res.ok) throw new Error();
      categories = await res.json();
      populateCategoryDropdowns();
    } catch {
      categories = [];
    }
  }

  function populateCategoryDropdowns() {
    const selects = [document.getElementById('lead-category'), document.getElementById('edit-category')];
    selects.forEach(sel => {
      if (!sel) return;
      const val = sel.value;
      sel.innerHTML = '<option value="">Uncategorized</option>';
      categories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c._id;
        opt.textContent = c.name;
        sel.appendChild(opt);
      });
      sel.value = val;
    });
  }

  // ─── Load Leads ────────────────────────────────────────────
  async function loadLeads() {
    showLoading(true);
    try {
      const search = searchInput.value.trim();
      let url = `/api/leads?status=${currentTab}&limit=5000`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      allLeads = data.leads;
      renderLeads(allLeads);
    } catch (err) {
      showToast('Failed to load leads', 'error');
    }
    showLoading(false);
  }

  // Per-category page state: { categoryId: pageNumber }
  const categoryPages = {};
  const expandedCategories = new Set();
  const PER_CAT_PAGE = 20;

  // ─── Render Leads (grouped by category) ────────────────────
  function renderLeads(leads) {
    leadsList.innerHTML = '';
    leadsPagination.innerHTML = '';

    // Group leads by category
    const groups = new Map();

    // First: add all known categories (so empty ones show up)
    categories.forEach(c => {
      groups.set(c._id, {
        id: c._id,
        name: c.name,
        color: c.color,
        leads: []
      });
    });

    // Then: distribute leads into groups
    leads.forEach(lead => {
      const catId = lead.category ? lead.category._id : 'uncategorized';
      if (!groups.has(catId)) {
        groups.set(catId, {
          id: catId,
          name: lead.category ? lead.category.name : 'Uncategorized',
          color: lead.category ? lead.category.color : '#6b7084',
          leads: []
        });
      }
      groups.get(catId).leads.push(lead);
    });

    // Always add uncategorized group
    if (!groups.has('uncategorized')) {
      groups.set('uncategorized', {
        id: 'uncategorized',
        name: 'Uncategorized',
        color: '#6b7084',
        leads: []
      });
    }

    // Check if everything is empty
    const totalLeads = [...groups.values()].reduce((sum, g) => sum + g.leads.length, 0);
    if (totalLeads === 0 && categories.length === 0) {
      emptyState.classList.remove('hidden');
      return;
    }
    emptyState.classList.add('hidden');

    // Sort: named categories first (by name), uncategorized last
    const sorted = [...groups.values()].sort((a, b) => {
      if (a.id === 'uncategorized') return 1;
      if (b.id === 'uncategorized') return -1;
      return a.name.localeCompare(b.name);
    });

    sorted.forEach(group => {
      const catPage = categoryPages[group.id] || 1;
      const totalPages = Math.ceil(group.leads.length / PER_CAT_PAGE) || 1;
      const startIdx = (catPage - 1) * PER_CAT_PAGE;
      const pageLeads = group.leads.slice(startIdx, startIdx + PER_CAT_PAGE);

      const groupEl = document.createElement('div');
      const isExpanded = expandedCategories.has(group.id);
      groupEl.className = isExpanded ? 'category-group' : 'category-group collapsed';
      groupEl.dataset.categoryId = group.id;

      groupEl.innerHTML = `
        <div class="category-group-header">
          <div class="category-group-header-left">
            <div class="category-color-dot" style="background:${escAttr(group.color)}"></div>
            <span class="category-group-name">${esc(group.name)}</span>
            <span class="category-group-count">${group.leads.length}</span>
          </div>
          <svg class="category-group-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <div class="category-group-body">
          <div class="category-group-body-inner"></div>
          ${totalPages > 1 ? `<div class="category-pagination" data-cat-id="${group.id}"></div>` : ''}
        </div>
      `;

      // Category header click to collapse/expand
      const body = groupEl.querySelector('.category-group-body');
      if (isExpanded) {
        requestAnimationFrame(() => {
          body.style.maxHeight = 'none';
          body.style.overflow = 'visible';
          body.style.opacity = '1';
        });
      }
      groupEl.querySelector('.category-group-header').addEventListener('click', () => {
        if (!groupEl.classList.contains('collapsed')) {
          // Collapse — set explicit height first since it may be 'none'
          body.style.overflow = 'hidden';
          body.style.maxHeight = body.scrollHeight + 'px';
          body.offsetHeight; // force reflow
          body.style.maxHeight = '0px';
          body.style.opacity = '0';
          groupEl.classList.add('collapsed');
          expandedCategories.delete(group.id);
        } else {
          // Expand
          groupEl.classList.remove('collapsed');
          body.style.overflow = 'hidden';
          body.style.opacity = '1';
          body.style.maxHeight = body.scrollHeight + 'px';
          body.addEventListener('transitionend', function handler(e) {
            if (e.propertyName !== 'max-height') return;
            if (!groupEl.classList.contains('collapsed')) {
              body.style.maxHeight = 'none';
              body.style.overflow = 'visible';
            }
            body.removeEventListener('transitionend', handler);
          });
          expandedCategories.add(group.id);
        }
      });

      // Drag-and-drop zone
      groupEl.addEventListener('dragover', (e) => { e.preventDefault(); groupEl.classList.add('drag-over'); });
      groupEl.addEventListener('dragleave', (e) => {
        if (!groupEl.contains(e.relatedTarget)) groupEl.classList.remove('drag-over');
      });
      groupEl.addEventListener('drop', (e) => {
        e.preventDefault();
        groupEl.classList.remove('drag-over');
        const leadId = e.dataTransfer.getData('text/plain');
        const newCatId = group.id === 'uncategorized' ? null : group.id;
        if (leadId) handleDragDrop(leadId, newCatId);
      });

      const bodyInner = groupEl.querySelector('.category-group-body-inner');
      if (pageLeads.length === 0) {
        bodyInner.innerHTML = '<div class="category-group-empty">No leads in this category</div>';
      } else {
        pageLeads.forEach(lead => {
          bodyInner.appendChild(createLeadCard(lead));
        });
      }

      // Per-category pagination controls
      if (totalPages > 1) {
        const pagDiv = groupEl.querySelector('.category-pagination');
        let pagHtml = '';
        if (catPage > 1) pagHtml += `<button class="page-btn" data-cat-page="${catPage - 1}">← Prev</button>`;
        for (let i = 1; i <= totalPages; i++) {
          pagHtml += `<button class="page-btn ${i === catPage ? 'active' : ''}" data-cat-page="${i}">${i}</button>`;
        }
        if (catPage < totalPages) pagHtml += `<button class="page-btn" data-cat-page="${catPage + 1}">Next →</button>`;
        pagDiv.innerHTML = pagHtml;

        pagDiv.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-cat-page]');
          if (!btn) return;
          categoryPages[group.id] = parseInt(btn.dataset.catPage);
          renderLeads(allLeads);
        });
      }

      leadsList.appendChild(groupEl);
    });
  }

  function createLeadCard(lead) {
    const card = document.createElement('div');
    card.className = 'lead-card';
    card.dataset.id = lead._id;
    card.draggable = true;

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', lead._id);
      card.classList.add('dragging');
      e.stopPropagation();
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));

    card.innerHTML = `
      <div class="lead-header" data-action="toggle" data-id="${lead._id}">
        <div class="lead-header-left">
          <span class="lead-company">${esc(lead.companyName)}</span>
          ${lead.country ? `<span class="lead-badge lead-badge-green">${esc(lead.country)}</span>` : ''}
          ${lead.createdBy ? `<span class="lead-badge ${lead.createdBy.discordId === '662949997691535361' ? 'lead-badge-blue' : 'lead-badge-yellow'}">${esc(lead.createdBy.username)}</span>` : ''}
        </div>
        <svg class="lead-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      <div class="lead-body" id="body-${lead._id}">
        <div class="lead-body-inner">
          <div class="lead-detail">
            <div class="lead-detail-label">Email</div>
            <div class="lead-email-row">
              <div class="lead-detail-value lead-email-clickable" data-action="copy" data-id="${lead._id}" title="Click to copy">${esc(lead.email)}</div>
              <button class="btn-copy" data-action="copy" data-id="${lead._id}">Copy</button>
            </div>
          </div>
          ${lead.website ? `
          <div class="lead-detail">
            <div class="lead-detail-label">Website</div>
            <div class="lead-detail-value"><a href="${escAttr(sanitizeUrl(lead.website))}" target="_blank" rel="noopener noreferrer" class="lead-website-link">${esc(lead.website)}</a></div>
          </div>` : ''}
          ${lead.address ? `
          <div class="lead-detail">
            <div class="lead-detail-label">Address</div>
            <div class="lead-detail-value lead-address">${esc(lead.address)}</div>
          </div>` : ''}

          <div class="lead-actions">
            <select class="status-select" data-action="status" data-id="${lead._id}">
              <option value="active" ${lead.status === 'active' ? 'selected' : ''}>Active</option>
              <option value="blacklisted" ${lead.status === 'blacklisted' ? 'selected' : ''}>Blacklisted</option>
              <option value="accepted" ${lead.status === 'accepted' ? 'selected' : ''}>Accepted</option>
            </select>
            <button class="btn-icon" title="Edit" data-action="edit" data-id="${lead._id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="btn-icon" title="Delete" data-action="delete" data-id="${lead._id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>

          <div class="notes-section">
            <div class="notes-title">Notes</div>
            <div class="notes-list" id="notes-${lead._id}">
              <div class="loading-state" style="padding:16px 0"><div class="spinner"></div></div>
            </div>
            <div class="note-input-row">
              <input type="text" class="note-input" id="note-input-${lead._id}" placeholder="Add a comment..." data-action="note-input" data-id="${lead._id}">
              <button class="btn btn-sm btn-primary" data-action="add-note" data-id="${lead._id}">Add</button>
            </div>
          </div>
        </div>
      </div>
    `;

    return card;
  }

  // ─── Drag & Drop Category Reassignment ─────────────────────
  async function handleDragDrop(leadId, newCategoryId) {
    try {
      const res = await fetch(`/api/leads/${leadId}/category`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: newCategoryId })
      });
      if (!res.ok) throw new Error();
      showToast('Lead moved', 'success');
      await loadLeads();
    } catch {
      showToast('Failed to move lead', 'error');
    }
  }

  // ─── Leads Pagination ─────────────────────────────────────
  function renderLeadsPagination(pagination) {
    leadsPagination.innerHTML = '';
    if (!pagination || pagination.pages <= 1) return;
    let html = '';
    if (leadsPage > 1) html += `<button class="page-btn" data-page="${leadsPage - 1}">← Prev</button>`;
    for (let i = 1; i <= pagination.pages; i++) {
      html += `<button class="page-btn ${i === leadsPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }
    if (leadsPage < pagination.pages) html += `<button class="page-btn" data-page="${leadsPage + 1}">Next →</button>`;
    leadsPagination.innerHTML = html;
  }

  // ─── Toggle Accordion ──────────────────────────────────────
  function toggleAccordion(id) {
    const card = document.querySelector(`.lead-card[data-id="${id}"]`);
    const body = $(`#body-${id}`);

    if (card.classList.contains('expanded')) {
      // Collapse — need explicit height first since it may be 'none'
      body.style.overflow = 'hidden';
      body.style.maxHeight = body.scrollHeight + 'px';
      body.offsetHeight; // force reflow
      body.style.maxHeight = '0px';
      card.classList.remove('expanded');
    } else {
      // Collapse others
      $$('.lead-card.expanded').forEach(c => {
        c.classList.remove('expanded');
        const otherBody = c.querySelector('.lead-body');
        otherBody.style.overflow = 'hidden';
        otherBody.style.maxHeight = otherBody.scrollHeight + 'px';
        otherBody.offsetHeight;
        otherBody.style.maxHeight = '0px';
      });

      card.classList.add('expanded');
      body.style.maxHeight = body.scrollHeight + 'px';
      // After transition, remove max-height constraint so tall content isn't clipped
      body.addEventListener('transitionend', function handler(e) {
        if (e.propertyName !== 'max-height') return;
        if (card.classList.contains('expanded')) {
          body.style.maxHeight = 'none';
          body.style.overflow = 'visible';
        }
        body.removeEventListener('transitionend', handler);
      });
      loadNotes(id);
    }
  }

  // ─── Load Notes ────────────────────────────────────────────
  async function loadNotes(leadId) {
    const container = $(`#notes-${leadId}`);
    try {
      const res = await fetch(`/api/notes/${leadId}`);
      if (!res.ok) throw new Error();
      const notes = await res.json();
      renderNotes(leadId, notes);
    } catch {
      container.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">Failed to load notes</p>';
    }
  }

  function renderNotes(leadId, notes) {
    const container = $(`#notes-${leadId}`);
    if (notes.length === 0) {
      container.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">No notes yet</p>';
      return;
    }
    container.innerHTML = notes.map(n => `
      <div class="note-card">
        <div class="note-content">${esc(n.content)}</div>
        <div class="note-meta">
          <div class="note-user">${esc(n.userId?.username || 'Unknown')}</div>
          <div>${formatDate(n.createdAt)}</div>
          <div>${timeAgo(n.createdAt)}</div>
        </div>
      </div>
    `).join('');

    // Recalculate accordion height — just remove constraint since card is already expanded
    const body = $(`#body-${leadId}`);
    if (body) {
      body.style.maxHeight = 'none';
      body.style.overflow = 'visible';
    }
  }

  // ─── Add Note ──────────────────────────────────────────────
  async function addNote(leadId) {
    const input = $(`#note-input-${leadId}`);
    const content = input.value.trim();
    if (!content) return;

    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, content })
      });
      if (!res.ok) throw new Error();
      input.value = '';
      showToast('Note added', 'success');
      await loadNotes(leadId);
    } catch {
      showToast('Failed to add note', 'error');
    }
  }

  // ─── Add Lead ──────────────────────────────────────────────
  async function handleAddLead(e) {
    e.preventDefault();
    const form = e.target;
    const catVal = $('#lead-category').value;
    const data = {
      companyName: $('#lead-company').value.trim(),
      email: $('#lead-email').value.trim(),
      website: $('#lead-website').value.trim(),
      address: $('#lead-address').value.trim(),
      country: $('#lead-country').value.trim(),
      category: catVal || null
    };

    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      form.reset();
      closeModal('modal-add');
      showToast('Lead created', 'success');
      await loadLeads();
    } catch (err) {
      showToast(err.message || 'Failed to create lead', 'error');
    }
  }

  // ─── Edit Lead ─────────────────────────────────────────────
  function openEdit(id) {
    const lead = allLeads.find(l => l._id === id);
    if (!lead) return;

    $('#edit-lead-id').value = id;
    $('#edit-company').value = lead.companyName;
    $('#edit-email').value = lead.email;
    $('#edit-website').value = lead.website || '';
    $('#edit-address').value = lead.address || '';
    $('#edit-country').value = lead.country || '';
    $('#edit-category').value = lead.category ? lead.category._id : '';
    openModal('modal-edit');
  }

  async function handleEditLead(e) {
    e.preventDefault();
    const id = $('#edit-lead-id').value;
    const catVal = $('#edit-category').value;
    const data = {
      companyName: $('#edit-company').value.trim(),
      email: $('#edit-email').value.trim(),
      website: $('#edit-website').value.trim(),
      address: $('#edit-address').value.trim(),
      country: $('#edit-country').value.trim(),
      category: catVal || null
    };

    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      closeModal('modal-edit');
      showToast('Lead updated', 'success');
      await loadLeads();
    } catch (err) {
      showToast(err.message || 'Failed to update lead', 'error');
    }
  }

  // ─── Delete Lead ───────────────────────────────────────────
  let deleteTargetId = null;

  function openDelete(id, name) {
    deleteTargetId = id;
    $('#delete-lead-name').textContent = name;
    openModal('modal-delete');
  }

  $('#delete-confirm-btn').addEventListener('click', async () => {
    if (!deleteTargetId) return;
    try {
      const res = await fetch(`/api/leads/${deleteTargetId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      closeModal('modal-delete');
      showToast('Lead deleted', 'success');
      deleteTargetId = null;
      await loadLeads();
    } catch {
      showToast('Failed to delete lead', 'error');
    }
  });

  // ─── Change Status ─────────────────────────────────────────
  async function changeStatus(id, newStatus) {
    try {
      const res = await fetch(`/api/leads/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (!res.ok) throw new Error();
      showToast(`Lead moved to ${newStatus}`, 'success');
      await loadLeads();
    } catch {
      showToast('Failed to change status', 'error');
    }
  }

  // ─── Copy Email ────────────────────────────────────────────
  async function copyEmail(email, trigger) {
    try {
      await navigator.clipboard.writeText(email);
      // Find the copy button in the same row
      const row = trigger.closest('.lead-email-row');
      const btn = row ? row.querySelector('.btn-copy') : null;
      if (btn) {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
      }
      showToast('Email copied', 'success');
    } catch {
      showToast('Copy failed', 'error');
    }
  }

  // filterLeads removed — search is now handled server-side via loadLeads()

  // ─── Load Logs ─────────────────────────────────────────────
  async function loadLogs() {
    logsList.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading logs...</p></div>';
    logsEmpty.classList.add('hidden');
    logsPagination.innerHTML = '';

    try {
      const res = await fetch(`/api/logs?page=${logsPage}&limit=20`);
      if (!res.ok) throw new Error();
      const data = await res.json();

      if (data.logs.length === 0) {
        logsList.innerHTML = '';
        logsEmpty.classList.remove('hidden');
        return;
      }

      logsList.innerHTML = data.logs.map(log => {
        const badge = getBadgeClass(log.action);
        const text = getLogText(log);
        const changes = getLogChanges(log);
        return `
          <div class="log-entry">
            <span class="log-badge ${badge.cls}">${badge.label}</span>
            <div class="log-body">
              <div class="log-text">${text}</div>
              ${changes ? `<div class="log-changes">${changes}</div>` : ''}
              <div class="log-time">${new Date(log.createdAt).toLocaleString()}</div>
            </div>
          </div>
        `;
      }).join('');

      // Pagination
      if (data.pagination.pages > 1) {
        let html = '';
        if (logsPage > 1) html += `<button class="page-btn" data-page="${logsPage - 1}">← Prev</button>`;
        for (let i = 1; i <= data.pagination.pages; i++) {
          html += `<button class="page-btn ${i === logsPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
        }
        if (logsPage < data.pagination.pages) html += `<button class="page-btn" data-page="${logsPage + 1}">Next →</button>`;
        logsPagination.innerHTML = html;
      }
    } catch {
      logsList.innerHTML = '<p style="text-align:center;color:var(--text-muted)">Failed to load logs</p>';
    }
  }

  function getBadgeClass(action) {
    const map = {
      lead_created: { cls: 'created', label: 'Created' },
      lead_edited: { cls: 'edited', label: 'Edited' },
      lead_deleted: { cls: 'deleted', label: 'Deleted' },
      lead_status_changed: { cls: 'status', label: 'Status' },
      note_added: { cls: 'note', label: 'Note' },
      unauthorized_login: { cls: 'deleted', label: 'Blocked' },
      category_created: { cls: 'created', label: 'Cat+' },
      category_edited: { cls: 'edited', label: 'Cat~' },
      category_deleted: { cls: 'deleted', label: 'Cat-' }
    };
    return map[action] || { cls: '', label: action };
  }

  function getLogText(log) {
    const user = `<strong>${esc(log.performedBy?.username || 'Unknown')}</strong>`;
    const d = log.details || {};
    switch (log.action) {
      case 'lead_created': return `${user} created lead <strong>${esc(d.companyName || '')}</strong>`;
      case 'lead_edited': return `${user} edited <strong>${esc(d.companyName || '')}</strong>`;
      case 'lead_deleted': return `${user} deleted <strong>${esc(d.companyName || '')}</strong>`;
      case 'lead_status_changed': return `${user} moved <strong>${esc(d.companyName || '')}</strong> from ${d.oldStatus} → ${d.newStatus}`;
      case 'note_added': return `${user} added a note on <strong>${esc(d.leadCompany || '')}</strong>`;
      case 'unauthorized_login': return `Unauthorized login attempt by <strong>${esc(d.username || 'Unknown')}</strong> (${esc(d.discordId || '')})`;
      case 'category_created': return `${user} created category <strong>${esc(d.categoryName || '')}</strong>`;
      case 'category_edited': return `${user} edited category <strong>${esc(d.categoryName || '')}</strong>`;
      case 'category_deleted': return `${user} deleted category <strong>${esc(d.categoryName || '')}</strong>${d.leadsDeleted ? ` (${d.leadsDeleted} leads removed)` : ''}`;
      default: return `${user} performed ${log.action}`;
    }
  }

  function getLogChanges(log) {
    if (log.action !== 'lead_edited' || !log.details?.changes) return '';
    return log.details.changes.map(c =>
      `${c.field}: <span>"${esc(c.oldValue)}"</span> → <span>"${esc(c.newValue)}"</span>`
    ).join('<br>');
  }

  // logsNav removed — handled by event delegation

  // ─── Category Manager ──────────────────────────────────────
  function renderCategoryManager() {
    const list = $('#categories-manager-list');
    if (categories.length === 0) {
      list.innerHTML = '<div class="categories-manager-empty">No categories yet. Add one below.</div>';
      return;
    }
    list.innerHTML = categories.map(c => `
      <div class="category-manager-item" data-id="${c._id}">
        <input type="color" class="category-manager-color" value="${escAttr(c.color)}" data-id="${c._id}" title="Change color">
        <input type="text" class="category-manager-name" value="${escAttr(c.name)}" data-id="${c._id}" maxlength="100">
        <button class="category-manager-delete" data-id="${c._id}" title="Delete category">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    `).join('');

    // Inline edit: name
    list.querySelectorAll('.category-manager-name').forEach(input => {
      input.addEventListener('change', () => updateCategory(input.dataset.id, { name: input.value }));
    });
    // Inline edit: color
    list.querySelectorAll('.category-manager-color').forEach(input => {
      input.addEventListener('change', () => updateCategory(input.dataset.id, { color: input.value }));
    });
    // Delete
    list.querySelectorAll('.category-manager-delete').forEach(btn => {
      btn.addEventListener('click', () => openDeleteCategoryModal(btn.dataset.id));
    });
  }

  async function handleAddCategory() {
    const nameInput = $('#new-category-name');
    const colorInput = $('#new-category-color');
    const name = nameInput.value.trim();
    if (!name) return;

    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color: colorInput.value })
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      nameInput.value = '';
      colorInput.value = '#6366f1';
      showToast('Category created', 'success');
      await loadCategories();
      renderCategoryManager();
      await loadLeads();
    } catch (err) {
      showToast(err.message || 'Failed to create category', 'error');
    }
  }

  async function updateCategory(id, data) {
    try {
      const res = await fetch(`/api/categories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error();
      showToast('Category updated', 'success');
      await loadCategories();
      await loadLeads();
    } catch {
      showToast('Failed to update category', 'error');
    }
  }

  // ─── Delete Category Modal with Cooldown ───────────────────
  function openDeleteCategoryModal(catId) {
    const cat = categories.find(c => c._id === catId);
    if (!cat) return;
    deleteCategoryTarget = catId;
    $('#delete-category-name').textContent = cat.name;

    // Reset cooldown button
    const cooldownBtn = $('#delete-category-with-leads-btn');
    cooldownBtn.disabled = true;
    const timerSpan = cooldownBtn.querySelector('.btn-cooldown-timer');

    // Start 5-second cooldown
    let remaining = 5;
    timerSpan.textContent = `(${remaining}s)`;
    if (cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(cooldownTimer);
        cooldownTimer = null;
        cooldownBtn.disabled = false;
        timerSpan.textContent = '';
      } else {
        timerSpan.textContent = `(${remaining}s)`;
      }
    }, 1000);

    openModal('modal-delete-category');
  }

  function closeDeleteCategoryModal() {
    closeModal('modal-delete-category');
    deleteCategoryTarget = null;
    if (cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null; }
  }

  async function handleDeleteCategory(deleteLeads) {
    if (!deleteCategoryTarget) return;
    const catId = deleteCategoryTarget;
    try {
      const url = `/api/categories/${catId}${deleteLeads ? '?deleteLeads=true' : ''}`;
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      closeDeleteCategoryModal();
      showToast(deleteLeads ? 'Category and leads deleted' : 'Category deleted, leads kept', 'success');
      await loadCategories();
      renderCategoryManager();
      await loadLeads();
    } catch {
      showToast('Failed to delete category', 'error');
    }
  }

  // ─── Backup ────────────────────────────────────────────────
  async function handleBackup() {
    try {
      showToast('Starting backup...', 'info');
      const res = await fetch('/api/backup', { method: 'POST' });
      if (!res.ok) throw new Error();
      showToast('Backup completed!', 'success');
    } catch {
      showToast('Backup failed', 'error');
    }
  }

  // ─── Helpers ───────────────────────────────────────────────
  function openModal(id) { $(`#${id}`).classList.remove('hidden'); }
  function closeModal(id) { $(`#${id}`).classList.add('hidden'); }

  function showLoading(show) {
    loadingState.classList.toggle('hidden', !show);
    if (show) { leadsList.innerHTML = ''; emptyState.classList.add('hidden'); }
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('hiding');
      toast.addEventListener('animationend', () => toast.remove());
    }, 2500);
  }

  function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function sanitizeUrl(url) {
    if (!url) return '';
    try {
      const parsed = new URL(url.startsWith('http') ? url : 'https://' + url);
      if (['http:', 'https:'].includes(parsed.protocol)) return parsed.href;
    } catch {}
    return '';
  }

  function timeAgo(date) {
    const s = Math.floor((Date.now() - new Date(date)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  function formatDate(date) {
    const d = new Date(date);
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // No window.LF — all events handled via delegation (XSS-safe)

  // Boot
  init();
})();

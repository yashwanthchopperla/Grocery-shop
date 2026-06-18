/* =============================================
   KIRANA SHOP BILLING SYSTEM — script.js
   ============================================= */

'use strict';

/* =============================================
   CONSTANTS & STATE
   ============================================= */

const LS_DARK      = 'kirana_dark';
const LS_BILL_CTR  = 'kirana_bill_counter';

/** In-memory state */
let products   = [];   // { id, name, price, unit, category }
let billItems  = [];   // { productId, name, qty, unit, price }
let bills      = [];   // { billNo, customer, phone, items, grandTotal, timestamp }
let editingId  = null; // id of product being edited, or null
let pendingDeleteId = null;

/* =============================================
   UTILITY HELPERS
   ============================================= */

/** Format number as Indian Rupee */
function rupee(n) {
  return '₹' + Number(n).toFixed(2);
}

/** Show a toast notification */
function showToast(msg, duration = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

/** Switch active tab programmatically */
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
  document.getElementById(`tab-${tabId}`).classList.add('active');
  // Update dashboard counters whenever user navigates there
  if (tabId === 'dashboard') refreshDashboard();
}

/* =============================================
   API HELPERS
   ============================================= */

async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    if (res.ok) {
      const data = await res.json();
      products = data.map(p => ({ ...p, id: p._id || p.id }));
    }
  } catch (err) {
    console.error('Failed to load products', err);
    showToast('⚠️ Error loading products');
  }
}

async function loadBills() {
  try {
    const res = await fetch('/api/bills');
    if (res.ok) {
      bills = await res.json();
    }
  } catch (err) {
    console.error('Failed to load bills', err);
  }
}

async function saveBillRecord(billData) {
  try {
    const res = await fetch('/api/bills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(billData)
    });
    if (res.ok) {
      const newBill = await res.json();
      bills.push(newBill);
    }
  } catch (err) {
    console.error('Failed to save bill', err);
    showToast('⚠️ Error saving bill');
  }
}

function getTodayBills() {
  const today = new Date().toDateString();
  return bills.filter(b => new Date(b.timestamp).toDateString() === today);
}

function getNextBillNo() {
  let ctr = parseInt(localStorage.getItem(LS_BILL_CTR) || '1000', 10);
  ctr++;
  localStorage.setItem(LS_BILL_CTR, ctr.toString());
  return ctr;
}

/* =============================================
   DATE & TIME CLOCK
   ============================================= */

function updateClock() {
  const now = new Date();
  document.getElementById('liveDate').textContent =
    now.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  document.getElementById('liveTime').textContent =
    now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/* =============================================
   DARK MODE
   ============================================= */

function initDarkMode() {
  const dark = localStorage.getItem(LS_DARK) === 'true';
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.getElementById('darkIcon').textContent = dark ? '☀️' : '🌙';
}

document.getElementById('darkToggle').addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
  localStorage.setItem(LS_DARK, (!isDark).toString());
  document.getElementById('darkIcon').textContent = isDark ? '🌙' : '☀️';
});

/* =============================================
   TAB SWITCHING (click handler)
   ============================================= */

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    switchTab(tab);
    if (tab === 'billing') refreshBillDropdown();
  });
});

/* =============================================
   DASHBOARD
   ============================================= */

function refreshDashboard() {
  // Stat cards
  document.getElementById('statProducts').textContent = products.length;

  const todayBills = getTodayBills();
  document.getElementById('statBills').textContent = todayBills.length;

  const revenue = todayBills.reduce((sum, b) => sum + (b.grandTotal || 0), 0);
  document.getElementById('statRevenue').textContent = rupee(revenue);

  const lastBillNo = localStorage.getItem(LS_BILL_CTR) || '—';
  document.getElementById('statLastBill').textContent =
    lastBillNo !== '—' ? '#' + lastBillNo : '—';

  // Product count badge
  document.getElementById('dashProductCount').textContent = `${products.length} items`;

  // Product preview chips
  const grid = document.getElementById('dashProductGrid');
  if (products.length === 0) {
    grid.innerHTML = '<p class="empty-msg">No products yet. Add some from the Products tab.</p>';
    return;
  }
  grid.innerHTML = products.map(p => `
    <div class="preview-chip">
      <div class="preview-chip-name" title="${esc(p.name)}">${esc(p.name)}</div>
      <div class="preview-chip-price">${rupee(p.price)}</div>
      <div class="preview-chip-unit">per ${esc(p.unit)}</div>
    </div>
  `).join('');
}

/* =============================================
   PRODUCT MANAGEMENT
   ============================================= */

/** Escape HTML to prevent XSS */
function esc(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(str)));
  return d.innerHTML;
}

/** Save or update product */
async function saveProduct() {
  const name     = document.getElementById('productName').value.trim();
  const priceStr = document.getElementById('productPrice').value.trim();
  const unit     = document.getElementById('productUnit').value;
  const category = document.getElementById('productCategory').value;

  // Validation
  if (!name) { showToast('⚠️ Product name is required'); document.getElementById('productName').focus(); return; }
  if (!priceStr || isNaN(parseFloat(priceStr)) || parseFloat(priceStr) < 0) {
    showToast('⚠️ Enter a valid price'); document.getElementById('productPrice').focus(); return;
  }

  const price = parseFloat(parseFloat(priceStr).toFixed(2));
  const productData = { name, price, unit, category };

  try {
    if (editingId) {
      // Update existing product
      const res = await fetch(`/api/products/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(productData)
      });
      if (res.ok) {
        showToast('✅ Product updated!');
      }
      editingId = null;
      document.getElementById('formTitle').textContent = 'Add New Product';
      document.getElementById('saveProductBtn').textContent = '💾 Save Product';
      document.getElementById('cancelEditBtn').style.display = 'none';
    } else {
      // Add new product
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(productData)
      });
      if (res.ok) {
        showToast('✅ Product added!');
      }
    }

    await loadProducts();
    clearProductForm();
    renderProductTable();
    refreshDashboard();
  } catch (err) {
    console.error('Failed to save product', err);
    showToast('⚠️ Error saving product');
  }
}

/** Populate form for editing */
function editProduct(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  editingId = id;
  document.getElementById('productName').value    = p.name;
  document.getElementById('productPrice').value   = p.price;
  document.getElementById('productUnit').value    = p.unit;
  document.getElementById('productCategory').value = p.category;
  document.getElementById('formTitle').textContent = '✏️ Edit Product';
  document.getElementById('saveProductBtn').textContent = '💾 Update Product';
  document.getElementById('cancelEditBtn').style.display = 'inline-flex';
  document.getElementById('productName').focus();
  // Scroll to form
  document.querySelector('.form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Cancel editing and reset form */
function cancelEdit() {
  editingId = null;
  clearProductForm();
  document.getElementById('formTitle').textContent = 'Add New Product';
  document.getElementById('saveProductBtn').textContent = '💾 Save Product';
  document.getElementById('cancelEditBtn').style.display = 'none';
}

/** Clear product form inputs */
function clearProductForm() {
  document.getElementById('productName').value  = '';
  document.getElementById('productPrice').value = '';
  document.getElementById('productUnit').value  = 'kg';
  document.getElementById('productCategory').value = 'Grains & Dal';
}

/** Initiate delete with confirmation dialog */
function deleteProduct(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  pendingDeleteId = id;
  document.getElementById('confirmMsg').textContent =
    `Delete "${p.name}"? This cannot be undone.`;
  document.getElementById('confirmModal').style.display = 'flex';
  document.getElementById('confirmYes').onclick = confirmDelete;
}

async function confirmDelete() {
  if (!pendingDeleteId) return;
  try {
    const res = await fetch(`/api/products/${pendingDeleteId}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('🗑️ Product deleted');
      await loadProducts();
      renderProductTable();
      refreshDashboard();
    }
  } catch (err) {
    console.error('Failed to delete product', err);
    showToast('⚠️ Error deleting product');
  } finally {
    closeConfirm();
  }
}

function closeConfirm() {
  document.getElementById('confirmModal').style.display = 'none';
  pendingDeleteId = null;
}

// Close modal on overlay click
document.getElementById('confirmModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeConfirm();
});

/** Render the products table with optional search filter */
function renderProductTable() {
  const query = (document.getElementById('productSearch')?.value || '').toLowerCase();
  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(query) ||
    (p.category || '').toLowerCase().includes(query)
  );

  document.getElementById('productCount').textContent =
    `${filtered.length} of ${products.length} products`;

  const tbody = document.getElementById('productTableBody');

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">No products found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((p, i) => `
    <tr>
      <td class="row-index">${i + 1}</td>
      <td><strong>${esc(p.name)}</strong></td>
      <td class="price-cell">${rupee(p.price)}</td>
      <td><span class="unit-tag">${esc(p.unit)}</span></td>
      <td><span class="cat-tag">${esc(p.category || 'Other')}</span></td>
      <td>
        <div class="action-btns">
          <button class="btn-icon edit" onclick="editProduct('${p.id}')">✏️ Edit</button>
          <button class="btn-icon del"  onclick="deleteProduct('${p.id}')">🗑 Del</button>
        </div>
      </td>
    </tr>
  `).join('');
}

/* =============================================
   BILLING — PRODUCT DROPDOWN
   ============================================= */

let selectedProduct = null; // the currently selected product object

/** Populate the searchable dropdown with all products */
function refreshBillDropdown() {
  filterBillDropdown();
}

/** Filter dropdown items based on typed text */
function filterBillDropdown() {
  const query = document.getElementById('billProductSearch').value.toLowerCase();
  const list  = document.getElementById('billDropdown');

  const matches = products.filter(p =>
    p.name.toLowerCase().includes(query) ||
    (p.category || '').toLowerCase().includes(query)
  );

  if (matches.length === 0) {
    list.innerHTML = '<div class="dropdown-item" style="color:var(--text-muted)">No products found</div>';
    list.classList.add('open');
    return;
  }

  list.innerHTML = matches.map(p => `
    <div class="dropdown-item" data-id="${p.id}" onclick="selectBillProduct('${p.id}')">
      <span class="dropdown-item-name">${esc(p.name)} <span style="font-size:0.76rem;color:var(--text-muted)">${esc(p.unit)}</span></span>
      <span class="dropdown-item-price">${rupee(p.price)}</span>
    </div>
  `).join('');

  list.classList.add('open');
}

function showDropdown() {
  filterBillDropdown();
  document.getElementById('billDropdown').classList.add('open');
}

/** Called when a product is selected from the dropdown */
function selectBillProduct(id) {
  selectedProduct = products.find(p => p.id === id);
  if (!selectedProduct) return;
  document.getElementById('billProductSearch').value = selectedProduct.name;
  document.getElementById('billProductSelect').value = id;
  document.getElementById('billUnitPrice').value =
    `${rupee(selectedProduct.price)} / ${selectedProduct.unit}`;
  document.getElementById('billDropdown').classList.remove('open');
  document.getElementById('billQty').focus();
}

// Close dropdown when clicking outside
document.addEventListener('click', e => {
  const wrap = document.querySelector('.combo-wrapper');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('billDropdown').classList.remove('open');
  }
});

/* =============================================
   BILLING — ADD ITEMS
   ============================================= */

/** Add selected product + qty to bill */
function addItemToBill() {
  if (!selectedProduct) {
    showToast('⚠️ Please select a product first');
    document.getElementById('billProductSearch').focus();
    return;
  }

  const qtyStr = document.getElementById('billQty').value;
  const qty    = parseFloat(qtyStr);
  if (!qtyStr || isNaN(qty) || qty <= 0) {
    showToast('⚠️ Enter a valid quantity');
    document.getElementById('billQty').focus();
    return;
  }

  // Check if item already exists → update qty
  const existing = billItems.find(i => i.productId === selectedProduct.id);
  if (existing) {
    existing.qty = parseFloat((existing.qty + qty).toFixed(3));
    showToast(`🔄 Updated qty for ${selectedProduct.name}`);
  } else {
    billItems.push({
      productId: selectedProduct.id,
      name:      selectedProduct.name,
      qty:       parseFloat(qty.toFixed(3)),
      unit:      selectedProduct.unit,
      price:     selectedProduct.price,
    });
    showToast(`✅ Added ${selectedProduct.name}`);
  }

  renderBillTable();
  recalcTotal();

  // Reset add-item form
  document.getElementById('billProductSearch').value = '';
  document.getElementById('billProductSelect').value = '';
  document.getElementById('billUnitPrice').value     = '';
  document.getElementById('billQty').value           = '1';
  selectedProduct = null;
  document.getElementById('billProductSearch').focus();
}

/** Remove item from bill */
function removeBillItem(idx) {
  billItems.splice(idx, 1);
  renderBillTable();
  recalcTotal();
}

/** Re-render the bill items table */
function renderBillTable() {
  const card = document.getElementById('billTableCard');
  const tbody = document.getElementById('billTableBody');

  if (billItems.length === 0) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';

  tbody.innerHTML = billItems.map((item, i) => {
    const subtotal = item.qty * item.price;
    return `
      <tr>
        <td class="row-index">${i + 1}</td>
        <td><strong>${esc(item.name)}</strong></td>
        <td>
          <input type="number"
            class="qty-inline"
            value="${item.qty}"
            min="0.1" step="0.1"
            onchange="updateBillQty(${i}, this.value)"
            style="width:70px;padding:5px 6px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font-sans);"
          />
        </td>
        <td><span class="unit-tag">${esc(item.unit)}</span></td>
        <td class="price-cell">${rupee(item.price)}</td>
        <td class="price-cell">${rupee(subtotal)}</td>
        <td><button class="btn-icon del" onclick="removeBillItem(${i})">✖</button></td>
      </tr>
    `;
  }).join('');
}

/** Update quantity of an existing bill item inline */
function updateBillQty(idx, val) {
  const qty = parseFloat(val);
  if (isNaN(qty) || qty <= 0) return;
  billItems[idx].qty = parseFloat(qty.toFixed(3));
  renderBillTable();
  recalcTotal();
}

/** Recalculate and display bill totals */
function recalcTotal() {
  const subtotal = billItems.reduce((sum, item) => sum + item.qty * item.price, 0);
  const discount = Math.max(0, parseFloat(document.getElementById('discountAmount')?.value || 0) || 0);
  const grand    = Math.max(0, subtotal - discount);

  document.getElementById('totalSubtotal').textContent = rupee(subtotal);
  document.getElementById('grandTotal').textContent    = rupee(grand);
}

/* =============================================
   BILLING — BILL ACTIONS
   ============================================= */

/** Clear all items from current bill */
function clearBill() {
  if (billItems.length === 0) return;
  if (!confirm('Clear all items from this bill?')) return;
  billItems = [];
  renderBillTable();
  recalcTotal();
  document.getElementById('discountAmount').value = '0';
  document.getElementById('billTableCard').style.display = 'none';
  showToast('🗑️ Bill cleared');
}

/** Build the HTML for a printable/PDF bill */
function buildBillHTML(billNo, customerName, customerPhone) {
  const now      = new Date();
  const dateStr  = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr  = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const subtotal = billItems.reduce((s, i) => s + i.qty * i.price, 0);
  const discount = Math.max(0, parseFloat(document.getElementById('discountAmount')?.value || 0) || 0);
  const grand    = Math.max(0, subtotal - discount);

  const rows = billItems.map((item, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${item.name}</td>
      <td>${item.qty} ${item.unit}</td>
      <td>₹${item.price.toFixed(2)}</td>
      <td>₹${(item.qty * item.price).toFixed(2)}</td>
    </tr>
  `).join('');

  return `
    <div class="print-bill">
      <div class="print-header">
        <div class="print-shop-name">🛒 Sri Lakshmi Kirana Store</div>
        <div class="print-tagline">Fresh · Fast · Trusted</div>
      </div>
      <hr class="print-divider"/>
      <div class="print-meta">
        <strong>Bill No:</strong> #${billNo}&nbsp;&nbsp;
        <strong>Date:</strong> ${dateStr}&nbsp;&nbsp;
        <strong>Time:</strong> ${timeStr}
      </div>
      ${customerName ? `<div class="print-meta"><strong>Customer:</strong> ${customerName}${customerPhone ? ' | ' + customerPhone : ''}</div>` : ''}
      <hr class="print-divider"/>
      <table class="print-table">
        <thead>
          <tr><th>#</th><th>Product</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <hr class="print-divider"/>
      <div class="print-totals">
        <div>Subtotal: <strong>₹${subtotal.toFixed(2)}</strong></div>
        ${discount > 0 ? `<div>Discount: <strong>-₹${discount.toFixed(2)}</strong></div>` : ''}
        <div class="print-grand">Grand Total: ₹${grand.toFixed(2)}</div>
      </div>
      <hr class="print-divider"/>
      <div class="print-footer">Thank you for shopping! 🙏<br/>Please visit again.</div>
    </div>
  `;
}

/** Validate bill has items */
function validateBill() {
  if (billItems.length === 0) {
    showToast('⚠️ Add at least one item to the bill');
    return false;
  }
  return true;
}

/** Print bill */
async function printBill() {
  if (!validateBill()) return;
  const billNo   = getNextBillNo();
  const customer = document.getElementById('customerName').value.trim();
  const phone    = document.getElementById('customerPhone').value.trim();

  // Save bill record
  await saveBillRecord({
    billNo, customer, phone,
    items: billItems.slice(),
    grandTotal: Math.max(0,
      billItems.reduce((s,i) => s + i.qty * i.price, 0) -
      (parseFloat(document.getElementById('discountAmount').value) || 0)
    ),
  });

  // Update bill number badge
  document.getElementById('billNoBadge').textContent = `Bill #${billNo}`;

  // Inject printable HTML
  const area = document.getElementById('printBillArea');
  area.innerHTML = buildBillHTML(billNo, customer, phone);
  area.style.display = 'block';

  setTimeout(() => {
    window.print();
    area.style.display = 'none';
    refreshDashboard();
    showToast('🖨️ Print dialog opened');
  }, 100);
}

/** Download bill as PDF using jsPDF */
async function downloadBillPDF() {
  if (!validateBill()) return;

  if (typeof window.jspdf === 'undefined') {
    showToast('⚠️ PDF library not loaded, please try printing instead');
    return;
  }

  const { jsPDF } = window.jspdf;
  const billNo   = getNextBillNo();
  const customer = document.getElementById('customerName').value.trim();
  const phone    = document.getElementById('customerPhone').value.trim();
  const now      = new Date();
  const dateStr  = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr  = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const subtotal = billItems.reduce((s, i) => s + i.qty * i.price, 0);
  const discount = Math.max(0, parseFloat(document.getElementById('discountAmount').value) || 0);
  const grand    = Math.max(0, subtotal - discount);

  // Save bill record
  await saveBillRecord({
    billNo, customer, phone,
    items: billItems.slice(),
    grandTotal: grand,
  });

  document.getElementById('billNoBadge').textContent = `Bill #${billNo}`;

  const doc = new jsPDF({ unit: 'mm', format: 'a5', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  let y = 10;

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Sri Lakshmi Kirana Store', W / 2, y, { align: 'center' });
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Fresh · Fast · Trusted', W / 2, y, { align: 'center' });
  y += 6;

  // Divider
  doc.setDrawColor(180);
  doc.setLineDash([2, 1]);
  doc.line(10, y, W - 10, y); y += 5;
  doc.setLineDash([]);

  // Bill meta
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(`Bill No: #${billNo}`, 10, y);
  doc.text(`Date: ${dateStr}  Time: ${timeStr}`, W - 10, y, { align: 'right' });
  y += 5;
  if (customer) {
    doc.text(`Customer: ${customer}${phone ? '  |  ' + phone : ''}`, 10, y);
    y += 5;
  }

  doc.setLineDash([2, 1]);
  doc.line(10, y, W - 10, y); y += 5;
  doc.setLineDash([]);

  // Table header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setFillColor(240, 235, 220);
  doc.rect(10, y - 3, W - 20, 6, 'F');
  doc.text('#',          12, y);
  doc.text('Product',    20, y);
  doc.text('Qty',       100, y);
  doc.text('Rate',      120, y);
  doc.text('Amount',    145, y);
  y += 6;

  // Table rows
  doc.setFont('helvetica', 'normal');
  billItems.forEach((item, idx) => {
    const subtotalItem = item.qty * item.price;
    if (y > 180) { doc.addPage(); y = 10; }
    if (idx % 2 === 0) {
      doc.setFillColor(252, 250, 245);
      doc.rect(10, y - 3, W - 20, 6, 'F');
    }
    doc.text(String(idx + 1),                12, y);
    doc.text(item.name.slice(0, 28),         20, y);
    doc.text(`${item.qty} ${item.unit}`,    100, y);
    doc.text(`Rs.${item.price.toFixed(2)}`, 120, y);
    doc.text(`Rs.${subtotalItem.toFixed(2)}`, 145, y);
    y += 6;
  });

  // Divider
  doc.setDrawColor(180);
  doc.setLineDash([2, 1]);
  doc.line(10, y, W - 10, y); y += 5;
  doc.setLineDash([]);

  // Totals
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Subtotal:`, 110, y);
  doc.text(`Rs.${subtotal.toFixed(2)}`, W - 10, y, { align: 'right' });
  y += 5;

  if (discount > 0) {
    doc.setTextColor(200, 40, 40);
    doc.text(`Discount:`, 110, y);
    doc.text(`-Rs.${discount.toFixed(2)}`, W - 10, y, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    y += 5;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Grand Total:`, 100, y);
  doc.text(`Rs.${grand.toFixed(2)}`, W - 10, y, { align: 'right' });
  y += 10;

  // Footer
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text('Thank you for shopping! Please visit again.', W / 2, y, { align: 'center' });

  doc.save(`Bill_${billNo}_${dateStr.replace(/ /g, '_')}.pdf`);
  refreshDashboard();
  showToast(`✅ Bill #${billNo} downloaded as PDF`);
}

/* =============================================
   BULK UPLOAD FROM EXCEL
   ============================================= */

/** Handle file selected via input or drag-and-drop */
async function handleExcelUpload(input) {
  const file = input.files?.[0];
  if (!file) return;
  await processExcelFile(file);
  input.value = ''; // reset so same file can be re-uploaded
}

/** Process the Excel/CSV file */
async function processExcelFile(file) {
  const statusEl = document.getElementById('bulkUploadStatus');

  // Validate file type
  const validTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv'
  ];
  const validExts = ['.xlsx', '.xls', '.csv'];
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

  if (!validTypes.includes(file.type) && !validExts.includes(ext)) {
    statusEl.innerHTML = '<div class="upload-result error">Invalid file type. Please upload .xlsx, .xls, or .csv</div>';
    return;
  }

  statusEl.innerHTML = '<div class="upload-progress"><div class="upload-progress-bar" style="width: 10%"></div></div><p class="muted" style="margin-top:6px;">Reading file...</p>';

  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });

    // Use the first sheet
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rows.length === 0) {
      statusEl.innerHTML = '<div class="upload-result error">No data found in the file. Make sure your sheet has rows.</div>';
      return;
    }

    // Normalize column names (lowercase + trimmed)
    const normalizedRows = rows.map(row => {
      const normalized = {};
      for (const key of Object.keys(row)) {
        normalized[key.toLowerCase().trim()] = row[key];
      }
      return normalized;
    });

    // Validate required columns
    const firstRow = normalizedRows[0];
    const hasName = 'name' in firstRow;
    const hasPrice = 'price' in firstRow;

    if (!hasName || !hasPrice) {
      const missing = [];
      if (!hasName) missing.push('name');
      if (!hasPrice) missing.push('price');
      statusEl.innerHTML = `<div class="upload-result error">Missing required columns: <strong>${missing.join(', ')}</strong>. Your Excel must have columns: name, price, unit, category</div>`;
      return;
    }

    // Upload products one by one with progress
    let successCount = 0;
    let failCount = 0;
    const total = normalizedRows.length;

    for (let i = 0; i < normalizedRows.length; i++) {
      const row = normalizedRows[i];
      const name = String(row.name || '').trim();
      const price = parseFloat(row.price);
      const unit = String(row.unit || 'piece').trim();
      const category = String(row.category || 'Other').trim();

      if (!name || isNaN(price) || price < 0) {
        failCount++;
        continue;
      }

      try {
        const res = await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, price, unit, category })
        });
        if (res.ok) {
          successCount++;
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }

      // Update progress bar
      const progress = Math.round(((i + 1) / total) * 100);
      statusEl.innerHTML = `<div class="upload-progress"><div class="upload-progress-bar" style="width: ${progress}%"></div></div><p class="muted" style="margin-top:6px;">Uploading ${i + 1} of ${total}...</p>`;
    }

    // Show final result
    let resultHTML = `<div class="upload-result success">${successCount} product(s) added successfully!</div>`;
    if (failCount > 0) {
      resultHTML += `<div class="upload-result error" style="margin-top:6px;">${failCount} row(s) skipped (missing name or invalid price).</div>`;
    }
    statusEl.innerHTML = resultHTML;

    // Reload products
    await loadProducts();
    renderProductTable();
    refreshDashboard();
    showToast(`Uploaded ${successCount} products from Excel`);

  } catch (err) {
    console.error('Excel upload error:', err);
    statusEl.innerHTML = '<div class="upload-result error">Failed to read the file. Please check the format and try again.</div>';
  }
}

/** Drag-and-drop setup (runs after DOM is loaded) */
function initUploadZone() {
  const zone = document.getElementById('uploadZone');
  if (!zone) return;

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
  });

  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) processExcelFile(file);
  });

  // Click zone to trigger file input
  zone.addEventListener('click', e => {
    if (e.target.tagName !== 'LABEL') {
      document.getElementById('excelFileInput').click();
    }
  });
}

/* =============================================
   INIT
   ============================================= */

async function init() {
  initDarkMode();
  await loadProducts();
  await loadBills();
  renderProductTable();
  refreshDashboard();
  updateClock();
  setInterval(updateClock, 1000);
  initUploadZone();

  // Set initial bill number badge
  const ctr = localStorage.getItem(LS_BILL_CTR);
  document.getElementById('billNoBadge').textContent =
    ctr ? `Next: #${parseInt(ctr, 10) + 1}` : 'Bill #1001';

  // Close dropdown on ESC
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('billDropdown').classList.remove('open');
      if (document.getElementById('confirmModal').style.display === 'flex') closeConfirm();
    }
    // Enter key in billing product search = auto-select first item
    if (e.key === 'Enter' && document.activeElement === document.getElementById('billProductSearch')) {
      const first = document.querySelector('.dropdown-item[data-id]');
      if (first) first.click();
    }
  });

  console.log('✅ Kirana Shop Billing System initialized');
  console.log(`   Products loaded: ${products.length}`);
}

// Start the app
document.addEventListener('DOMContentLoaded', init);

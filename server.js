const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'store.json');

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function readStore() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    const fallback = {
      products: [],
      cart: [],
      wishlist: [],
      orders: [],
      customOrders: [],
      contactMessages: [],
      newsletterSubscribers: []
    };
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function calculateCartTotals(cart) {
  let subtotal = 0;
  for (const item of cart) {
    const pricePerItem = (Number(item.basePrice || 0) + Number(item.framePrice || 0)) * Number(item.qty || 1);
    subtotal += pricePerItem;
  }

  const discount = cart.length >= 2 ? Math.round(subtotal * 0.10) : 0;
  return {
    subtotal,
    discount,
    total: subtotal - discount
  };
}

function generateOrderId() {
  return `DRP-${Date.now().toString().slice(-6)}`;
}

function ensureCartItem(item) {
  return {
    posterId: item.posterId,
    title: item.title,
    size: item.size || 'A3 (12 × 18 in)',
    frame: item.frame || 'Matte Black Aluminum',
    framePrice: Number(item.framePrice || 0),
    basePrice: Number(item.basePrice || 0),
    qty: Number(item.qty || 1),
    svgType: item.svgType || 'default',
    accent: item.accent || '#CCFF00'
  };
}

function getProductById(productId) {
  const store = readStore();
  return store.products.find((product) => product.id === productId) || null;
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'DRIPSTER backend is running',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/products', (req, res) => {
  const store = readStore();
  res.json({ products: store.products });
});

app.get('/api/products/:id', (req, res) => {
  const product = getProductById(req.params.id);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  return res.json({ product });
});

app.get('/api/categories', (req, res) => {
  const store = readStore();
  const categories = [...new Set(store.products.map((product) => product.categoryKey))]
    .map((key) => ({
      key,
      label: store.products.find((product) => product.categoryKey === key)?.category || key
    }));
  res.json({ categories });
});

app.get('/api/cart', (req, res) => {
  const store = readStore();
  res.json({ cart: store.cart, totals: calculateCartTotals(store.cart) });
});

app.post('/api/cart/add', (req, res) => {
  const store = readStore();
  const item = ensureCartItem(req.body);

  if (!item.posterId) {
    return res.status(400).json({ error: 'posterId is required' });
  }

  const existing = store.cart.find(
    (cartItem) =>
      cartItem.posterId === item.posterId &&
      cartItem.size === item.size &&
      cartItem.frame === item.frame
  );

  if (existing) {
    existing.qty += Number(item.qty || 1);
  } else {
    store.cart.push(item);
  }

  writeStore(store);
  return res.status(201).json({ cart: store.cart, totals: calculateCartTotals(store.cart) });
});

app.patch('/api/cart/update', (req, res) => {
  const { posterId, size, frame, qty } = req.body;
  const store = readStore();

  const item = store.cart.find(
    (cartItem) =>
      cartItem.posterId === posterId &&
      cartItem.size === size &&
      cartItem.frame === frame
  );

  if (!item) {
    return res.status(404).json({ error: 'Cart item not found' });
  }

  item.qty = Number(qty || 0);
  if (item.qty <= 0) {
    store.cart = store.cart.filter(
      (cartItem) => !(cartItem.posterId === posterId && cartItem.size === size && cartItem.frame === frame)
    );
  }

  writeStore(store);
  return res.json({ cart: store.cart, totals: calculateCartTotals(store.cart) });
});

app.delete('/api/cart/remove', (req, res) => {
  const { posterId, size, frame } = req.query;
  const store = readStore();

  store.cart = store.cart.filter(
    (cartItem) => !(cartItem.posterId === posterId && cartItem.size === size && cartItem.frame === frame)
  );

  writeStore(store);
  return res.json({ cart: store.cart, totals: calculateCartTotals(store.cart) });
});

app.post('/api/cart/clear', (req, res) => {
  const store = readStore();
  store.cart = [];
  writeStore(store);
  return res.json({ cart: [], totals: { subtotal: 0, discount: 0, total: 0 } });
});

app.get('/api/wishlist', (req, res) => {
  const store = readStore();
  res.json({ wishlist: store.wishlist });
});

app.post('/api/wishlist/:productId', (req, res) => {
  const store = readStore();
  const { productId } = req.params;

  if (!store.wishlist.includes(productId)) {
    store.wishlist.push(productId);
    writeStore(store);
  }

  res.status(201).json({ wishlist: store.wishlist });
});

app.delete('/api/wishlist/:productId', (req, res) => {
  const store = readStore();
  const { productId } = req.params;
  store.wishlist = store.wishlist.filter((id) => id !== productId);
  writeStore(store);
  res.json({ wishlist: store.wishlist });
});

app.post('/api/custom-orders', (req, res) => {
  const store = readStore();
  const payload = req.body || {};

  const customOrder = {
    id: `CUST-${Date.now().toString().slice(-6)}`,
    title: payload.title || 'CUSTOM ONE-OF-ONE',
    subline: payload.subline || '',
    accent: payload.accent || '#CCFF00',
    style: payload.style || 'synthwave',
    createdAt: new Date().toISOString(),
    status: 'pending_review'
  };

  store.customOrders.push(customOrder);
  writeStore(store);

  res.status(201).json({ success: true, customOrder });
});

app.post('/api/contact', (req, res) => {
  const store = readStore();
  const payload = req.body || {};

  const message = {
    id: `MSG-${Date.now().toString().slice(-6)}`,
    name: payload.name || 'Anonymous',
    email: payload.email || '',
    subject: payload.subject || 'General inquiry',
    message: payload.message || '',
    createdAt: new Date().toISOString()
  };

  store.contactMessages.push(message);
  writeStore(store);

  res.status(201).json({ success: true, message });
});

app.post('/api/newsletter', (req, res) => {
  const store = readStore();
  const email = (req.body && req.body.email) || '';

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  if (!store.newsletterSubscribers.includes(email)) {
    store.newsletterSubscribers.push(email);
    writeStore(store);
  }

  return res.status(201).json({ success: true, email });
});

app.post('/api/checkout', (req, res) => {
  const store = readStore();

  if (!store.cart || store.cart.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  const totals = calculateCartTotals(store.cart);
  const orderId = generateOrderId();

  const order = {
    id: orderId,
    items: store.cart,
    customer: req.body || {},
    subtotal: totals.subtotal,
    discount: totals.discount,
    total: totals.total,
    status: 'order_received',
    createdAt: new Date().toISOString(),
    tracking: {
      step: 1,
      label: 'ORDER RECEIVED'
    }
  };

  store.orders.push(order);
  store.cart = [];
  writeStore(store);

  return res.status(201).json({ success: true, order });
});

app.get('/api/orders/:id', (req, res) => {
  const store = readStore();
  const order = store.orders.find((entry) => entry.id === req.params.id);

  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  return res.json({ order });
});

app.get('/api/orders/track/:id', (req, res) => {
  const store = readStore();
  const order = store.orders.find((entry) => entry.id === req.params.id);

  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  return res.json({
    orderId: order.id,
    status: order.status,
    tracking: order.tracking
  });
});

app.get('/api/seed', (req, res) => {
  const store = readStore();

  if (store.products.length === 0) {
    const source = require('./data/defaultProducts.json');
    store.products = source.products;
    writeStore(store);
  }

  res.json({ success: true, products: store.products });
});

app.use(express.static(__dirname));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  return res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`DRIPSTER backend is listening on http://localhost:${PORT}`);
});

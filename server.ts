import crypto from 'crypto';
import dns from 'dns';
import path from 'path';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import mongoose, { HydratedDocument, Model, Schema } from 'mongoose';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const isVercel = process.env.VERCEL === '1';
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const JWT_SECRET = process.env.JWT_SECRET || (isProduction ? '' : crypto.randomBytes(48).toString('hex'));
const ADMIN_USERNAME = process.env.ADMIN_USERNAME?.trim() || (isProduction ? '' : 'admin');
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH?.trim() || '';
const DEV_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim() || '';

if (isProduction && (!JWT_SECRET || !ADMIN_USERNAME || !ADMIN_PASSWORD_HASH)) {
  throw new Error('JWT_SECRET, ADMIN_USERNAME, and ADMIN_PASSWORD_HASH are required in production.');
}

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // Older Node versions may not support this option.
}

export interface AuthenticatedRequest extends Request {
  user?: { username: string; role: 'admin' };
}

// Thrown only by our own input validation (text/numberValue/parseInventoryInput).
// safeError() exposes messages from this class to clients but masks anything
// else, so an unexpected bug can't leak internal error text to the API caller.
class ValidationInputError extends Error {}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface InventoryInput {
  itemName: string;
  sku: string;
  category: string;
  quantity: number;
  price: number;
  lowStockThreshold: number;
  notes: string;
}

export interface IInventoryItem extends InventoryInput {
  lastUpdated: Date;
}

type InventoryDocument = HydratedDocument<IInventoryItem>;

interface MemoryItem extends InventoryInput {
  _id: string;
  lastUpdated: Date;
}

// Shape of a Mongoose `.lean()` result for IInventoryItem.
type LeanInventoryItem = IInventoryItem & { _id: unknown };

interface AuditInput {
  itemId: string;
  itemName: string;
  action: 'create' | 'update' | 'stock-adjustment' | 'delete' | 'seed' | 'clear';
  previousQuantity?: number;
  newQuantity?: number;
  reason?: string;
  performedBy: string;
  createdAt: Date;
}

const ItemSchema = new Schema<IInventoryItem>(
  {
    itemName: { type: String, required: true, trim: true, maxlength: 120 },
    sku: { type: String, required: true, trim: true, uppercase: true, maxlength: 64 },
    category: { type: String, required: true, trim: true, maxlength: 80 },
    quantity: { type: Number, required: true, min: 0 },
    price: { type: Number, required: true, min: 0 },
    lowStockThreshold: { type: Number, required: true, min: 0 },
    notes: { type: String, default: '', maxlength: 500 },
    lastUpdated: { type: Date, default: Date.now },
  },
  { versionKey: false }
);
ItemSchema.index({ sku: 1 }, { unique: true });

const AuditSchema = new Schema<AuditInput>(
  {
    itemId: { type: String, required: true, index: true },
    itemName: { type: String, required: true },
    action: { type: String, required: true },
    previousQuantity: Number,
    newQuantity: Number,
    reason: { type: String, maxlength: 300 },
    performedBy: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);

const InventoryModel: Model<IInventoryItem> =
  (mongoose.models.InventoryItem as Model<IInventoryItem> | undefined) ||
  mongoose.model<IInventoryItem>('InventoryItem', ItemSchema);

const AuditModel: Model<AuditInput> =
  (mongoose.models.InventoryAudit as Model<AuditInput> | undefined) ||
  mongoose.model<AuditInput>('InventoryAudit', AuditSchema);

let isMongoConnected = false;
let cachedConnection: Promise<void> | null = null;
let memoryStore: MemoryItem[] = [];
const memoryAudit: AuditInput[] = [];
let lastDatabaseError: string | null = null;

const DEFAULT_SEED_ITEMS: InventoryInput[] = [
  { itemName: 'Coca-Cola 500ml', sku: 'COKE-500', category: 'Soft Drinks', quantity: 24, price: 1.5, lowStockThreshold: 10, notes: 'Chilled bottle' },
  { itemName: 'Fanta Orange 500ml', sku: 'FANTA-500', category: 'Soft Drinks', quantity: 4, price: 1.5, lowStockThreshold: 8, notes: 'Low stock alert' },
  { itemName: 'Sprite 500ml', sku: 'SPRITE-500', category: 'Soft Drinks', quantity: 18, price: 1.5, lowStockThreshold: 5, notes: 'Plastic bottle' },
  { itemName: 'Voltic Mineral Water 1.5L', sku: 'VOLTIC-1500', category: 'Mineral Water', quantity: 35, price: 1, lowStockThreshold: 12, notes: 'Best seller' },
  { itemName: 'Sachet Water Pack (30)', sku: 'WATER-30', category: 'Mineral Water', quantity: 2, price: 2.5, lowStockThreshold: 5, notes: 'Critical low stock' },
  { itemName: 'Digestive Biscuits 200g', sku: 'DIGESTIVE-200', category: 'Snacks & Biscuits', quantity: 15, price: 1.2, lowStockThreshold: 5, notes: 'Crispy wheat' },
];

async function initDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 1) {
    isMongoConnected = true;
    return;
  }
  if (cachedConnection) return cachedConnection;

  const mongoUri = process.env.MONGODB_URI?.trim();
  if (!mongoUri) {
    isMongoConnected = false;
    lastDatabaseError = isProduction ? 'Database configuration is missing.' : null;
    return;
  }

  cachedConnection = (async () => {
    try {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 7000 });
      isMongoConnected = true;
      lastDatabaseError = null;
    } catch (error) {
      isMongoConnected = false;
      lastDatabaseError = error instanceof Error ? error.message : 'Database connection failed.';
      console.error('MongoDB connection failed:', lastDatabaseError);
    } finally {
      cachedConnection = null;
    }
  })();

  return cachedConnection;
}

function requireDatabase(req: Request, res: Response, next: NextFunction) {
  if (!isMongoConnected && (isProduction || isVercel)) {
    return res.status(503).json({ error: 'Inventory database is temporarily unavailable.' });
  }
  next();
}

function requireAdminAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Administrator login is required.' });
  }

  try {
    const decoded = jwt.verify(authorization.slice(7), JWT_SECRET) as { username: string; role: string };
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Administrator access is required.' });
    req.user = { username: decoded.username, role: 'admin' };
    next();
  } catch {
    return res.status(401).json({ error: 'The administrator session is invalid or expired.' });
  }
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

// Entries are only ever revisited by the same caller, so without a sweep
// this Map grows forever under scanning/bot traffic from rotating IPs.
// Periodically evict anything past its rate-limit window instead.
const loginAttemptsSweep = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of loginAttempts) {
    if (value.resetAt <= now) loginAttempts.delete(key);
  }
}, 15 * 60_000);
loginAttemptsSweep.unref();

function loginRateLimit(req: Request, res: Response, next: NextFunction) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60_000 });
    return next();
  }
  if (current.count >= 8) return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  current.count += 1;
  next();
}

function text(value: unknown, field: string, maxLength: number, required = true): string {
  if (typeof value !== 'string') {
    if (!required && (value === undefined || value === null)) return '';
    throw new ValidationInputError(`${field} must be text.`);
  }
  const result = value.trim();
  if (required && !result) throw new ValidationInputError(`${field} is required.`);
  if (result.length > maxLength) throw new ValidationInputError(`${field} must be ${maxLength} characters or fewer.`);
  return result;
}

function numberValue(value: unknown, field: string, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new ValidationInputError(`${field} must be a nonnegative ${integer ? 'whole number' : 'number'}.`);
  }
  return value;
}

function parseInventoryInput(body: Record<string, unknown>): InventoryInput {
  return {
    itemName: text(body.itemName, 'Item name', 120),
    sku: text(body.sku, 'SKU', 64).toUpperCase(),
    category: text(body.category, 'Category', 80),
    quantity: numberValue(body.quantity, 'Quantity', true),
    price: numberValue(body.price, 'Price'),
    lowStockThreshold: numberValue(body.lowStockThreshold, 'Low-stock threshold', true),
    notes: text(body.notes, 'Notes', 500, false),
  };
}

async function writeAudit(entry: AuditInput) {
  if (isMongoConnected) await AuditModel.create(entry);
  else memoryAudit.unshift(entry);
}

function safeError(error: unknown): string {
  if (error instanceof mongoose.Error.ValidationError) return 'The submitted inventory data is invalid.';
  if ((error as { code?: number })?.code === 11000) return 'That SKU is already in use.';
  if (error instanceof ValidationInputError) return error.message;
  // Anything else is unexpected — log the real error server-side and give
  // the client a generic message instead of leaking internal error text.
  console.error('Unexpected request error:', error);
  return 'The request could not be completed.';
}

export const app = express();
app.disable('x-powered-by');
// Number of upstream proxy hops to trust for X-Forwarded-For (used by req.ip,
// e.g. in the login rate limiter below). Must match the real chain in front
// of the app (e.g. 1 for a single ingress/load balancer) — too high and the
// rate limiter's IP key becomes attacker-spoofable via forged headers.
app.set('trust proxy', Number.parseInt(process.env.TRUST_PROXY_HOPS || '1', 10));
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // The production bundle has no inline scripts and no HMR, so it gets the
  // strict policy. Vite's dev middleware injects an inline React Refresh
  // bootstrap script and needs a websocket back to itself for HMR — under
  // the strict policy the browser silently blocks both and the app never
  // renders (it fails with "@vitejs/plugin-react can't detect preamble").
  res.setHeader(
    'Content-Security-Policy',
    isProduction
      ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
      : "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws:"
  );
  next();
});

// Registered before the DB-init middleware below so liveness checks never
// wait on Mongo. A liveness probe that can block on a DB timeout turns a
// database outage into a pod restart-loop instead of a readiness failure.
app.get('/api/health/live', (_req: Request, res: Response) => res.status(200).json({ status: 'ok' }));

app.use('/api', async (_req, _res, next) => {
  await initDatabase();
  next();
});

app.post('/api/auth/login', loginRateLimit, async (req, res) => {
  try {
    const username = text(req.body?.username, 'Username', 100);
    const password = text(req.body?.password, 'Password', 200);
    const validPassword = ADMIN_PASSWORD_HASH
      ? await bcrypt.compare(password, ADMIN_PASSWORD_HASH)
      : !isProduction && Boolean(DEV_ADMIN_PASSWORD) && password === DEV_ADMIN_PASSWORD;

    if (username !== ADMIN_USERNAME || !validPassword) {
      return res.status(401).json({ error: 'Invalid administrator credentials.' });
    }

    loginAttempts.delete(req.ip || req.socket.remoteAddress || 'unknown');
    return res.json({
      token: jwt.sign({ username: ADMIN_USERNAME, role: 'admin' }, JWT_SECRET, { expiresIn: '8h' }),
      user: { username: ADMIN_USERNAME, role: 'admin' },
    });
  } catch (error) {
    return res.status(400).json({ error: safeError(error) });
  }
});

app.get('/api/auth/me', requireAdminAuth, (req: AuthenticatedRequest, res) => {
  res.json({ isAuthenticated: true, user: req.user });
});

app.get('/api/health', (_req, res) => {
  res.status(isMongoConnected || (!isProduction && !isVercel) ? 200 : 503).json({
    status: isMongoConnected || (!isProduction && !isVercel) ? 'ok' : 'degraded',
    database: isMongoConnected ? 'available' : isProduction || isVercel ? 'unavailable' : 'development-memory',
  });
});

const MAX_PAGE_SIZE = 100;

app.get('/api/inventory', requireDatabase, async (req, res) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const category = typeof req.query.category === 'string' ? req.query.category : 'All';
    const stockStatus = typeof req.query.stockStatus === 'string' ? req.query.stockStatus : '';
    const allowedSorts = new Set(['itemName', 'category', 'quantity', 'price', 'lowStockThreshold', 'lastUpdated']);
    const sortBy = allowedSorts.has(String(req.query.sortBy)) ? String(req.query.sortBy) : 'itemName';
    const order = req.query.sortOrder === 'desc' ? -1 : 1;
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(String(req.query.pageSize ?? '20'), 10) || 20));

    // `low`/`healthy` compare two fields on the same document (quantity vs.
    // lowStockThreshold), which the Mongo path below expresses with $expr
    // instead of pulling the whole collection into Node to filter in memory.
    if (isMongoConnected) {
      const filter: Record<string, unknown> = {};
      if (category !== 'All') filter.category = category;
      if (stockStatus === 'out') filter.quantity = 0;
      if (stockStatus === 'low') filter.$expr = { $and: [{ $gt: ['$quantity', 0] }, { $lte: ['$quantity', '$lowStockThreshold'] }] };
      if (stockStatus === 'healthy') filter.$expr = { $gt: ['$quantity', '$lowStockThreshold'] };
      if (search) {
        const regex = new RegExp(escapeRegExp(search), 'i');
        filter.$or = [{ itemName: regex }, { sku: regex }, { category: regex }, { notes: regex }];
      }

      const [items, total] = await Promise.all([
        InventoryModel.find(filter)
          .sort({ [sortBy]: order })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean(),
        InventoryModel.countDocuments(filter),
      ]);
      return res.json({ items, total, page, pageSize });
    }

    let items = memoryStore.filter((item) => {
      if (search && ![item.itemName, item.sku, item.category, item.notes].some((value) => String(value || '').toLowerCase().includes(search))) return false;
      if (category !== 'All' && item.category !== category) return false;
      if (stockStatus === 'low' && !(item.quantity > 0 && item.quantity <= item.lowStockThreshold)) return false;
      if (stockStatus === 'out' && item.quantity !== 0) return false;
      if (stockStatus === 'healthy' && !(item.quantity > item.lowStockThreshold)) return false;
      return true;
    });
    items.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortBy];
      const bv = (b as unknown as Record<string, unknown>)[sortBy];
      if (sortBy === 'lastUpdated') return (new Date(av as string).getTime() - new Date(bv as string).getTime()) * order;
      return (typeof av === 'string' ? av.localeCompare(String(bv)) : Number(av) - Number(bv)) * order;
    });
    const total = items.length;
    items = items.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    res.json({ items, total, page, pageSize });
  } catch (error) {
    res.status(500).json({ error: safeError(error) });
  }
});

app.get('/api/inventory/stats', requireDatabase, async (_req, res) => {
  if (isMongoConnected) {
    const [result] = await InventoryModel.aggregate([
      {
        $group: {
          _id: null,
          totalItems: { $sum: 1 },
          totalUnits: { $sum: '$quantity' },
          totalValue: { $sum: { $multiply: ['$quantity', '$price'] } },
          lowStockCount: { $sum: { $cond: [{ $and: [{ $gt: ['$quantity', 0] }, { $lte: ['$quantity', '$lowStockThreshold'] }] }, 1, 0] } },
          outOfStockCount: { $sum: { $cond: [{ $eq: ['$quantity', 0] }, 1, 0] } },
          categories: { $addToSet: '$category' },
        },
      },
    ]);
    return res.json({
      totalItems: result?.totalItems ?? 0,
      totalUnits: result?.totalUnits ?? 0,
      totalValue: Math.round((result?.totalValue ?? 0) * 100) / 100,
      lowStockCount: result?.lowStockCount ?? 0,
      outOfStockCount: result?.outOfStockCount ?? 0,
      categoriesCount: result?.categories?.length ?? 0,
      categories: (result?.categories ?? []).sort(),
    });
  }

  const items = memoryStore;
  res.json({
    totalItems: items.length,
    totalUnits: items.reduce((sum, item) => sum + item.quantity, 0),
    totalValue: Math.round(items.reduce((sum, item) => sum + item.quantity * item.price, 0) * 100) / 100,
    lowStockCount: items.filter((item) => item.quantity > 0 && item.quantity <= item.lowStockThreshold).length,
    outOfStockCount: items.filter((item) => item.quantity === 0).length,
    categoriesCount: new Set(items.map((item) => item.category)).size,
    categories: [...new Set(items.map((item) => item.category))].sort(),
  });
});

app.post('/api/inventory', requireAdminAuth, requireDatabase, async (req: AuthenticatedRequest, res) => {
  try {
    const input = parseInventoryInput(req.body || {});
    let created: InventoryDocument | MemoryItem;
    if (isMongoConnected) {
      created = await InventoryModel.create({ ...input, lastUpdated: new Date() });
    } else {
      created = { _id: crypto.randomUUID(), ...input, lastUpdated: new Date() };
      memoryStore.unshift(created);
    }
    await writeAudit({ itemId: String(created._id), itemName: created.itemName, action: 'create', newQuantity: created.quantity, performedBy: req.user!.username, createdAt: new Date() });
    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({ error: safeError(error) });
  }
});

app.put('/api/inventory/:id', requireAdminAuth, requireDatabase, async (req: AuthenticatedRequest, res) => {
  try {
    const input = parseInventoryInput(req.body || {});
    let previous: LeanInventoryItem | MemoryItem | null;
    let updated: InventoryDocument | MemoryItem | null;
    if (isMongoConnected) {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid inventory item ID.' });
      previous = await InventoryModel.findById(req.params.id).lean();
      if (!previous) return res.status(404).json({ error: 'Inventory item not found.' });
      updated = await InventoryModel.findByIdAndUpdate(req.params.id, { ...input, lastUpdated: new Date() }, { new: true, runValidators: true });
    } else {
      const index = memoryStore.findIndex((item) => item._id === req.params.id);
      if (index < 0) return res.status(404).json({ error: 'Inventory item not found.' });
      previous = memoryStore[index];
      updated = { ...memoryStore[index], ...input, lastUpdated: new Date() };
      memoryStore[index] = updated;
    }
    // Only reachable in the Mongo branch: the item existed moments ago (the
    // `previous` lookup above) but was deleted before this update landed.
    if (!updated) return res.status(404).json({ error: 'Inventory item not found.' });
    await writeAudit({ itemId: String(updated._id), itemName: updated.itemName, action: 'update', previousQuantity: previous.quantity, newQuantity: updated.quantity, performedBy: req.user!.username, createdAt: new Date() });
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: safeError(error) });
  }
});

app.patch('/api/inventory/:id/stock', requireAdminAuth, requireDatabase, async (req: AuthenticatedRequest, res) => {
  try {
    const hasDelta = typeof req.body?.delta === 'number';
    const hasQuantity = typeof req.body?.quantity === 'number';
    if (hasDelta === hasQuantity) return res.status(400).json({ error: 'Provide either a numeric delta or a numeric quantity.' });
    if (hasDelta && !Number.isInteger(req.body.delta)) throw new ValidationInputError('Delta must be a whole number.');
    if (hasQuantity) numberValue(req.body.quantity, 'Quantity', true);
    const reason = text(req.body?.reason, 'Reason', 300, false);

    let item: InventoryDocument | MemoryItem;
    let previousQuantity: number;
    let nextQuantity: number;

    if (isMongoConnected) {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid inventory item ID.' });

      // `before` is only a best-effort snapshot for the audit log below — it
      // may be stale if another request updates concurrently, but that never
      // affects the write itself. The actual update is atomic: the decrement
      // guard (quantity >= -delta) is enforced by the query filter itself,
      // not by reading the value here and writing it back, so two concurrent
      // adjustments to the same item can't race past each other and drive
      // stock negative (the lost-update problem read-modify-write has).
      const before = await InventoryModel.findById(req.params.id).select('quantity').lean();
      if (!before) return res.status(404).json({ error: 'Inventory item not found.' });
      previousQuantity = before.quantity;

      const filter: Record<string, unknown> = { _id: req.params.id };
      const update = hasDelta
        ? { $inc: { quantity: req.body.delta }, $set: { lastUpdated: new Date() } }
        : { $set: { quantity: req.body.quantity, lastUpdated: new Date() } };
      if (hasDelta && req.body.delta < 0) filter.quantity = { $gte: -req.body.delta };

      const updated = await InventoryModel.findOneAndUpdate(filter, update, { new: true });
      if (!updated) {
        const stillExists = await InventoryModel.exists({ _id: req.params.id });
        if (!stillExists) return res.status(404).json({ error: 'Inventory item not found.' });
        throw new ValidationInputError('Resulting quantity must be a nonnegative whole number.');
      }
      item = updated;
      nextQuantity = updated.quantity;
    } else {
      const found = memoryStore.find((entry) => entry._id === req.params.id);
      if (!found) return res.status(404).json({ error: 'Inventory item not found.' });
      previousQuantity = found.quantity;
      nextQuantity = hasDelta ? previousQuantity + req.body.delta : req.body.quantity;
      numberValue(nextQuantity, 'Resulting quantity', true);
      found.quantity = nextQuantity;
      found.lastUpdated = new Date();
      item = found;
    }

    await writeAudit({ itemId: String(item._id), itemName: item.itemName, action: 'stock-adjustment', previousQuantity, newQuantity: nextQuantity, reason, performedBy: req.user!.username, createdAt: new Date() });
    res.json(item);
  } catch (error) {
    res.status(400).json({ error: safeError(error) });
  }
});

app.delete('/api/inventory/:id', requireAdminAuth, requireDatabase, async (req: AuthenticatedRequest, res) => {
  try {
    let deleted: InventoryDocument | MemoryItem | undefined;
    if (isMongoConnected) {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid inventory item ID.' });
      deleted = await InventoryModel.findByIdAndDelete(req.params.id);
    } else {
      const index = memoryStore.findIndex((item) => item._id === req.params.id);
      if (index >= 0) [deleted] = memoryStore.splice(index, 1);
    }
    if (!deleted) return res.status(404).json({ error: 'Inventory item not found.' });
    await writeAudit({ itemId: String(deleted._id), itemName: deleted.itemName, action: 'delete', previousQuantity: deleted.quantity, performedBy: req.user!.username, createdAt: new Date() });
    res.json({ message: 'Inventory item deleted.' });
  } catch (error) {
    res.status(500).json({ error: safeError(error) });
  }
});

app.get('/api/audit', requireAdminAuth, requireDatabase, async (_req, res) => {
  const records = isMongoConnected ? await AuditModel.find({}).sort({ createdAt: -1 }).limit(100).lean() : memoryAudit.slice(0, 100);
  res.json(records);
});

app.post('/api/inventory/seed', requireAdminAuth, requireDatabase, async (req: AuthenticatedRequest, res) => {
  try {
    if (isProduction && process.env.ALLOW_DEMO_SEED !== 'true') return res.status(403).json({ error: 'Demo seeding is disabled in production.' });
    if (isMongoConnected) {
      await InventoryModel.deleteMany({});
      await InventoryModel.insertMany(DEFAULT_SEED_ITEMS.map((item) => ({ ...item, lastUpdated: new Date() })));
    } else {
      memoryStore = DEFAULT_SEED_ITEMS.map((item) => ({ _id: crypto.randomUUID(), ...item, lastUpdated: new Date() }));
    }
    await writeAudit({ itemId: 'all', itemName: 'Inventory', action: 'seed', performedBy: req.user!.username, createdAt: new Date() });
    res.json({ message: 'Demo inventory loaded.' });
  } catch (error) {
    res.status(500).json({ error: safeError(error) });
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

async function startServer() {
  await initDatabase();
  if (!isProduction) {
    // Dynamic import so 'vite' is never require()'d in production -- it can
    // then be a devDependency instead of shipping (and its transitive
    // native-binary optional dependencies, e.g. rollup's platform package)
    // into the production image.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  const server = app.listen(PORT, '0.0.0.0', () => console.log(`StoreTrack is running on http://localhost:${PORT}`));

  // Kubernetes sends SIGTERM before killing a pod (rollouts, scale-down, node
  // drains). Without this, in-flight requests get dropped and the Mongo
  // connection is never closed cleanly.
  const shutdown = (signal: NodeJS.Signals) => {
    console.log(`${signal} received, shutting down gracefully.`);
    const forceExit = setTimeout(() => {
      console.error('Graceful shutdown timed out, forcing exit.');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close(async (error) => {
      if (error) console.error('Error while closing HTTP server:', error);
      try {
        await mongoose.connection.close();
      } catch (closeError) {
        console.error('Error while closing MongoDB connection:', closeError);
      }
      clearTimeout(forceExit);
      process.exit(error ? 1 : 0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (!isVercel && process.env.NODE_ENV !== 'test') void startServer();
export default app;

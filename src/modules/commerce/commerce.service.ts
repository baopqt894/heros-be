import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { PayOS } from '@payos/node';
import {
  CommerceOrder,
  CommerceOrderDocument,
  ORDER_STATUSES,
  OrderStatus,
} from './commerce.schema';
import { CreateOrderDto } from './commerce.dto';

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const TERMINAL = ['PAID', 'CANCELLED', 'EXPIRED'];

@Injectable()
export class CommerceService {
  constructor(
    @InjectModel(CommerceOrder.name)
    private readonly orders: Model<CommerceOrderDocument>,
    private readonly config: ConfigService
  ) {}

  private payos() {
    if (
      !['PAYOS_CLIENT_ID', 'PAYOS_API_KEY', 'PAYOS_CHECKSUM_KEY'].every((key) =>
        this.config.get(key)
      )
    )
      throw new ServiceUnavailableException({ code: 'PAYOS_NOT_CONFIGURED' });
    return new PayOS({
      clientId: this.config.getOrThrow('PAYOS_CLIENT_ID'),
      apiKey: this.config.getOrThrow('PAYOS_API_KEY'),
      checksumKey: this.config.getOrThrow('PAYOS_CHECKSUM_KEY'),
      timeout: 15000,
      maxRetries: 0,
      logLevel: 'off',
    });
  }

  publicOrder(order: CommerceOrder) {
    return {
      orderCode: order.orderCode,
      quantity: order.quantity,
      amount: order.amount,
      method: order.method,
      status: order.status,
      checkoutUrl: order.checkoutUrl,
      createdAt: order.createdAt,
    };
  }
  private details(order: CommerceOrder) {
    return {
      ...this.publicOrder(order),
      customer: order.customer,
      accountLinked: Boolean(order.accountId),
      paidAt: order.paidAt,
    };
  }

  async history(userId: string, before?: number) {
    const items = await this.orders
      .find({
        accountId: userId,
        orderCode: { $lt: before || Number.MAX_SAFE_INTEGER },
      })
      .sort({ orderCode: -1 })
      .limit(21);
    return {
      orders: items.slice(0, 20).map((order) => this.publicOrder(order)),
      nextCursor: items.length > 20 ? items[19].orderCode : null,
    };
  }

  async create(userId: string, input: CreateOrderDto) {
    if (this.config.get('HEROS_CHECKOUT_ENABLED') !== 'true')
      throw new ServiceUnavailableException({ code: 'CHECKOUT_DISABLED' });
    // Preserve the original fingerprint format for migrated idempotency keys.
    const normalized = {
      name: input.name.trim(),
      email: input.email.trim(),
      phone: input.phone.trim(),
      address: input.address.trim(),
      quantity: input.quantity,
      method: input.method,
      requestId: input.requestId,
    };
    const fingerprint = hash(JSON.stringify(normalized));
    let order = await this.orders.findOne({ requestId: input.requestId });
    let created = false;
    let guestToken: string | null = null;
    if (!order) {
      guestToken = randomBytes(32).toString('hex');
      try {
        order = await this.orders.create({
          ...normalized,
          customer: {
            name: normalized.name,
            email: normalized.email,
            phone: normalized.phone,
            address: normalized.address,
          },
          orderCode: Date.now() * 1000 + randomInt(0, 1000),
          accountId: new Types.ObjectId(userId),
          fingerprint,
          accessHash: hash(guestToken),
          amount: input.quantity * 590000,
          status: input.method === 'cod' ? 'COD_CONFIRMED' : 'CREATING',
          createdAt: new Date(),
        });
        created = true;
      } catch (error) {
        if (error.code !== 11000) throw error;
        order = await this.orders.findOne({ requestId: input.requestId });
        guestToken = null;
        if (!order)
          throw new ConflictException({ code: 'ORDER_CODE_COLLISION' });
      }
    }
    if (
      order.fingerprint !== fingerprint ||
      order.accountId?.toString() !== userId
    )
      throw new ConflictException({ code: 'ORDER_REQUEST_CONFLICT' });
    if (order.method === 'payos' && !order.checkoutUrl) {
      try {
        if (created) order = await this.createPayment(order);
        else order = await this.refreshPayment(order);
      } catch {
        // Never regress a PAID order on a late failure or create a second payment.
        if (created) await this.setStatus(order.orderCode, 'FAILED');
        return {
          order: this.publicOrder((await this.orders.findById(order._id))!),
          created,
          syncPending: true,
          guestToken,
        };
      }
    }
    return {
      order: this.publicOrder(order),
      created,
      syncPending: false,
      guestToken,
    };
  }

  async get(userId: string | null, code: number, guestToken?: string) {
    let order = await this.orders
      .findOne({ orderCode: code })
      .select('+accessHash');
    if (
      !order ||
      (order.accountId
        ? order.accountId.toString() !== userId
        : !this.guestAuthorized(order, guestToken))
    )
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
    let syncPending = false;
    if (order.method === 'payos' && !TERMINAL.includes(order.status)) {
      const acquired = await this.orders.updateOne(
        { _id: order._id, lastChecked: { $lt: Date.now() - 5000 } },
        { $set: { lastChecked: Date.now() } }
      );
      if (acquired.modifiedCount) {
        try {
          order = await this.refreshPayment(order);
        } catch {
          syncPending = true;
        }
      }
    }
    return { order: this.details(order), syncPending };
  }

  private guestAuthorized(order: CommerceOrder, token?: string) {
    return Boolean(
      token &&
      /^[a-f0-9]{64}$/.test(token) &&
      /^[a-f0-9]{64}$/.test(order.accessHash) &&
      timingSafeEqual(
        Buffer.from(hash(token), 'hex'),
        Buffer.from(order.accessHash, 'hex')
      )
    );
  }
  async claim(userId: string, email: string, code: number, token: string) {
    const order = await this.orders
      .findOne({ orderCode: code, accountId: null })
      .select('+accessHash');
    if (
      !order ||
      !this.guestAuthorized(order, token) ||
      order.customer.email.trim().toLowerCase() !== email.trim().toLowerCase()
    )
      throw new NotFoundException({ code: 'ORDER_CLAIM_DENIED' });
    const result = await this.orders.updateOne(
      { _id: order._id, accountId: null },
      { $set: { accountId: new Types.ObjectId(userId) } }
    );
    if (!result.modifiedCount)
      throw new ConflictException({ code: 'ORDER_ALREADY_CLAIMED' });
    return { claimed: true };
  }

  async setStatus(code: number, status: OrderStatus) {
    if (!(ORDER_STATUSES as readonly string[]).includes(status))
      throw new Error('Invalid payment status');
    await this.orders.updateOne(
      { orderCode: code, method: 'payos', status: { $ne: 'PAID' } },
      { $set: { status, ...(status === 'PAID' ? { paidAt: new Date() } : {}) } }
    );
  }
  async refreshPayment(order: CommerceOrderDocument) {
    const payment = await this.payos().paymentRequests.get(order.orderCode);
    if (
      payment.orderCode !== order.orderCode ||
      payment.amount !== order.amount ||
      (order.paymentLinkId && payment.id !== order.paymentLinkId) ||
      (payment.status === 'PAID' && payment.amountPaid < order.amount)
    )
      throw new Error('Payment mismatch');
    await this.orders.updateOne(
      { _id: order._id },
      {
        $set: {
          paymentLinkId: payment.id,
          checkoutUrl:
            order.checkoutUrl ||
            `https://pay.payos.vn/web/${encodeURIComponent(payment.id)}`,
        },
      }
    );
    await this.setStatus(order.orderCode, payment.status as OrderStatus);
    return (await this.orders.findById(order._id))!;
  }
  private async createPayment(order: CommerceOrderDocument) {
    const base = new URL(this.config.getOrThrow<string>('HEROS_SITE_URL'));
    if (
      base.protocol !== 'https:' &&
      !['localhost', '127.0.0.1'].includes(base.hostname)
    )
      throw new Error('Invalid site URL');
    const callback = `${base.origin}/thanh-toan?orderCode=${order.orderCode}`;
    const payment = await this.payos().paymentRequests.create({
      orderCode: order.orderCode,
      amount: order.amount,
      description: `HEROS ${order.orderCode}`,
      items: [{ name: 'Heros', quantity: order.quantity, price: 590000 }],
      returnUrl: callback,
      cancelUrl: callback,
      expiredAt: Math.floor(Date.now() / 1000) + 1800,
    });
    if (
      payment.orderCode !== order.orderCode ||
      payment.amount !== order.amount ||
      payment.currency !== 'VND'
    )
      throw new Error('Payment mismatch');
    const url = new URL(payment.checkoutUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'pay.payos.vn')
      throw new Error('Invalid checkout URL');
    await this.orders.updateOne(
      { _id: order._id },
      {
        $set: {
          paymentLinkId: payment.paymentLinkId,
          checkoutUrl: payment.checkoutUrl,
        },
      }
    );
    await this.orders.updateOne(
      { _id: order._id, status: { $in: ['CREATING', 'FAILED'] } },
      { $set: { status: 'PENDING' } }
    );
    return (await this.orders.findById(order._id))!;
  }
  async webhook(body: unknown) {
    let event: Awaited<ReturnType<PayOS['webhooks']['verify']>>;
    try {
      event = await this.payos().webhooks.verify(
        body as Parameters<PayOS['webhooks']['verify']>[0]
      );
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ConflictException({ code: 'PAYMENT_SIGNATURE_INVALID' });
    }
    const order = await this.orders.findOne({ orderCode: event.orderCode });
    if (!order) return { received: true };
    if (
      order.method !== 'payos' ||
      (order.paymentLinkId && order.paymentLinkId !== event.paymentLinkId)
    )
      throw new ConflictException({ code: 'PAYMENT_ORDER_MISMATCH' });
    if (event.code === '00' && event.currency === 'VND') {
      try {
        await this.refreshPayment(order);
      } catch {
        throw new ServiceUnavailableException({
          code: 'PAYMENT_RECONCILIATION_PENDING',
        });
      }
    }
    return { received: true };
  }
}

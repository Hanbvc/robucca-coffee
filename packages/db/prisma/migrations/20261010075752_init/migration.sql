-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER', 'KITCHEN');

-- CreateEnum
CREATE TYPE "MenuGroup" AS ENUM ('DRINKS', 'SNACK', 'FOOD', 'PASTRY');

-- CreateEnum
CREATE TYPE "Station" AS ENUM ('BAR', 'KITCHEN', 'NONE');

-- CreateEnum
CREATE TYPE "ModifierSelection" AS ENUM ('SINGLE', 'MULTIPLE');

-- CreateEnum
CREATE TYPE "InventoryUnit" AS ENUM ('GRAM', 'MILLILITER', 'PIECE');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('DINE_IN', 'TAKEAWAY', 'CLICK_COLLECT', 'FOOD_PLATFORM', 'DELIVERY');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('DINE_IN', 'TAKEAWAY', 'FOOD_PLATFORM');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('POS', 'PWA');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('OPEN', 'AWAITING_PAYMENT', 'PAID', 'VOIDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('RECEIVED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "KitchenStatus" AS ENUM ('QUEUED', 'DONE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'QRIS', 'DEBIT_CARD', 'CREDIT_CARD', 'E_WALLET', 'VIRTUAL_ACCOUNT', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('CASH_IN', 'CASH_OUT');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('SALE', 'SALE_REVERSAL', 'PURCHASE', 'ADJUSTMENT', 'WASTE', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'AMOUNT');

-- CreateEnum
CREATE TYPE "RoundingMode" AS ENUM ('DOWN', 'NEAREST', 'UP');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'SEATED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'PICKED_UP', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PointTransactionType" AS ENUM ('EARN', 'REDEEM', 'REVERSAL', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "Branch" (
    "id" UUID NOT NULL,
    "code" VARCHAR(4) NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "dayStartMinute" SMALLINT NOT NULL DEFAULT 0,
    "openTime" VARCHAR(5),
    "closeTime" VARCHAR(5),
    "taxLabel" TEXT NOT NULL DEFAULT 'PB1',
    "taxRateBp" INTEGER NOT NULL DEFAULT 1000,
    "taxInclusive" BOOLEAN NOT NULL DEFAULT true,
    "serviceRateBp" INTEGER NOT NULL DEFAULT 0,
    "taxOnService" BOOLEAN NOT NULL DEFAULT true,
    "receiptPaperMm" SMALLINT NOT NULL DEFAULT 80,
    "receiptFooter" TEXT,
    "acceptsPwa" BOOLEAN NOT NULL DEFAULT true,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "acceptsDelivery" BOOLEAN NOT NULL DEFAULT false,
    "deliveryMaxKm" DECIMAL(5,2),
    "acceptsReservations" BOOLEAN NOT NULL DEFAULT false,
    "maxReservationGuests" SMALLINT NOT NULL DEFAULT 30,
    "reservationAreas" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "code" "RoleCode" NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[],

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "pinHash" TEXT,
    "roleId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBranch" (
    "userId" UUID NOT NULL,
    "branchId" UUID NOT NULL,

    CONSTRAINT "UserBranch_pkey" PRIMARY KEY ("userId","branchId")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "branchId" UUID,
    "name" TEXT NOT NULL,
    "terminalNo" SMALLINT NOT NULL,
    "tokenHash" TEXT,
    "lastSeenAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "name" TEXT,
    "phoneVerifiedAt" TIMESTAMPTZ(3),
    "pointsBalance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "label" TEXT,
    "addressText" TEXT NOT NULL,
    "addressNote" TEXT,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientPhone" VARCHAR(16) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointTransaction" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "orderId" UUID,
    "type" "PointTransactionType" NOT NULL,
    "points" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "group" "MenuGroup" NOT NULL,
    "station" "Station" NOT NULL DEFAULT 'BAR',
    "quickNotes" TEXT[],
    "isSignature" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "categoryId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "basePrice" INTEGER NOT NULL,
    "station" "Station",
    "isSignature" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductBranch" (
    "productId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "priceOverride" INTEGER,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProductBranch_pkey" PRIMARY KEY ("productId","branchId")
);

-- CreateTable
CREATE TABLE "ModifierGroup" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "selection" "ModifierSelection" NOT NULL DEFAULT 'SINGLE',
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "maxSelect" SMALLINT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierOption" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "priceDelta" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ModifierOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductModifierGroup" (
    "productId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "showWhenOptionIds" UUID[],

    CONSTRAINT "ProductModifierGroup_pkey" PRIMARY KEY ("productId","groupId")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "InventoryUnit" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryStock" (
    "branchId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reorderLevel" DECIMAL(14,3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InventoryStock_pkey" PRIMARY KEY ("branchId","inventoryItemId")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" UUID NOT NULL,
    "productId" UUID,
    "modifierOptionId" UUID,
    "note" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeLine" (
    "recipeId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "RecipeLine_pkey" PRIMARY KEY ("recipeId","inventoryItemId")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "orderId" UUID,
    "transferId" UUID,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "deviceId" UUID,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openedById" UUID NOT NULL,
    "openedAt" TIMESTAMPTZ(3) NOT NULL,
    "openingCash" INTEGER NOT NULL,
    "closedById" UUID,
    "closedAt" TIMESTAMPTZ(3),
    "expectedCash" INTEGER,
    "countedCash" INTEGER,
    "countedDenominations" JSONB,
    "differenceNote" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "queueNumber" VARCHAR(8) NOT NULL,
    "source" "OrderSource" NOT NULL,
    "type" "OrderType" NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "fulfillment" "FulfillmentStatus" NOT NULL DEFAULT 'RECEIVED',
    "tableNumber" VARCHAR(10),
    "customerName" TEXT,
    "customerId" UUID,
    "deviceId" UUID,
    "shiftId" UUID,
    "cashierId" UUID,
    "businessDate" DATE NOT NULL,
    "pickupAt" TIMESTAMPTZ(3),
    "note" TEXT,
    "channelId" UUID,
    "channelMarkupBp" INTEGER NOT NULL DEFAULT 0,
    "platformOrderRef" VARCHAR(40),
    "promotionId" UUID,
    "reservationId" UUID,
    "customerPhone" VARCHAR(16),
    "subtotal" INTEGER NOT NULL,
    "discountTotal" INTEGER NOT NULL DEFAULT 0,
    "serviceCharge" INTEGER NOT NULL DEFAULT 0,
    "taxTotal" INTEGER NOT NULL DEFAULT 0,
    "deliveryFee" INTEGER NOT NULL DEFAULT 0,
    "rounding" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "taxRateBp" INTEGER NOT NULL,
    "taxInclusive" BOOLEAN NOT NULL,
    "serviceRateBp" INTEGER NOT NULL DEFAULT 0,
    "discountNote" TEXT,
    "discountApprovedById" UUID,
    "voidReason" TEXT,
    "voidedById" UUID,
    "voidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "paidAt" TIMESTAMPTZ(3),
    "readyAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "promotionId" UUID,
    "lineTotal" INTEGER NOT NULL,
    "note" TEXT,
    "station" "Station" NOT NULL,
    "kitchenStatus" "KitchenStatus" NOT NULL DEFAULT 'QUEUED',
    "sentToKitchenAt" TIMESTAMPTZ(3),
    "kitchenDoneAt" TIMESTAMPTZ(3),
    "voidedAt" TIMESTAMPTZ(3),
    "voidReason" TEXT,
    "voidedById" UUID,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemModifier" (
    "id" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "modifierOptionId" UUID NOT NULL,
    "groupName" TEXT NOT NULL,
    "optionName" TEXT NOT NULL,
    "priceDelta" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderItemModifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "shiftId" UUID,
    "method" "PaymentMethod" NOT NULL,
    "provider" TEXT,
    "paymentOptionId" UUID,
    "status" "PaymentStatus" NOT NULL,
    "amount" INTEGER NOT NULL,
    "tenderedAmount" INTEGER,
    "changeAmount" INTEGER,
    "gatewayReference" TEXT,
    "reference" TEXT,
    "receivedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "paidAt" TIMESTAMPTZ(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "shiftId" UUID,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedById" UUID NOT NULL,
    "processedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "branchId" UUID,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "orgName" TEXT NOT NULL DEFAULT 'Robucca',
    "tagline" TEXT,
    "instagram" TEXT,
    "roundingUnit" INTEGER NOT NULL DEFAULT 100,
    "roundingMode" "RoundingMode" NOT NULL DEFAULT 'DOWN',
    "maxCashierDiscountBp" INTEGER NOT NULL DEFAULT 1000,
    "autoLockMinutes" SMALLINT NOT NULL DEFAULT 0,
    "autoPrintReceipt" BOOLEAN NOT NULL DEFAULT false,
    "blockSaleWhenOutOfStock" BOOLEAN NOT NULL DEFAULT true,
    "kdsWarnMinutes" SMALLINT NOT NULL DEFAULT 8,
    "kdsLateMinutes" SMALLINT NOT NULL DEFAULT 15,
    "receiptFooter" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrganizationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesChannel" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL,
    "markupBp" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SalesChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentOption" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "provider" TEXT,
    "requiresReference" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PaymentOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DiscountType" NOT NULL,
    "value" INTEGER NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "allBranches" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMPTZ(3),
    "validUntil" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionBranch" (
    "promotionId" UUID NOT NULL,
    "branchId" UUID NOT NULL,

    CONSTRAINT "PromotionBranch_pkey" PRIMARY KEY ("promotionId","branchId")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "customerId" UUID,
    "name" TEXT NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "reservedFor" TIMESTAMPTZ(3) NOT NULL,
    "guests" SMALLINT NOT NULL,
    "area" TEXT,
    "occasion" TEXT,
    "note" TEXT,
    "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierService" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "baseFee" INTEGER NOT NULL,
    "perKmFee" INTEGER NOT NULL,
    "minFee" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CourierService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "courierServiceId" UUID NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientPhone" VARCHAR(16) NOT NULL,
    "addressText" TEXT NOT NULL,
    "addressNote" TEXT,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "distanceKm" DECIMAL(6,2) NOT NULL,
    "fee" INTEGER NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'SEARCHING_DRIVER',
    "externalId" TEXT,
    "driverName" TEXT,
    "driverPhone" VARCHAR(16),
    "vehiclePlate" VARCHAR(15),
    "trackingUrl" TEXT,
    "estimatedAt" TIMESTAMPTZ(3),
    "pickedUpAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Banner" (
    "id" UUID NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "categoryId" UUID,
    "objectPosition" TEXT NOT NULL DEFAULT 'center',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Banner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "UserBranch_branchId_idx" ON "UserBranch"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_tokenHash_key" ON "Device"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Device_branchId_terminalNo_key" ON "Device"("branchId", "terminalNo");

-- CreateIndex
CREATE UNIQUE INDEX "Device_id_branchId_key" ON "Device"("id", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phone_key" ON "Customer"("phone");

-- CreateIndex
CREATE INDEX "CustomerAddress_customerId_idx" ON "CustomerAddress"("customerId");

-- CreateIndex
CREATE INDEX "PointTransaction_customerId_createdAt_idx" ON "PointTransaction"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "PointTransaction_branchId_createdAt_idx" ON "PointTransaction"("branchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PointTransaction_orderId_type_key" ON "PointTransaction"("orderId", "type");

-- CreateIndex
CREATE INDEX "Category_group_sortOrder_idx" ON "Category"("group", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE INDEX "Product_categoryId_sortOrder_idx" ON "Product"("categoryId", "sortOrder");

-- CreateIndex
CREATE INDEX "ProductBranch_branchId_idx" ON "ProductBranch"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "ModifierOption_groupId_name_key" ON "ModifierOption"("groupId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_sku_key" ON "InventoryItem"("sku");

-- CreateIndex
CREATE INDEX "InventoryStock_inventoryItemId_idx" ON "InventoryStock"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_productId_key" ON "Recipe"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_modifierOptionId_key" ON "Recipe"("modifierOptionId");

-- CreateIndex
CREATE INDEX "RecipeLine_inventoryItemId_idx" ON "RecipeLine"("inventoryItemId");

-- CreateIndex
CREATE INDEX "StockMovement_branchId_inventoryItemId_createdAt_idx" ON "StockMovement"("branchId", "inventoryItemId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_branchId_createdAt_idx" ON "StockMovement"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_orderId_idx" ON "StockMovement"("orderId");

-- CreateIndex
CREATE INDEX "StockMovement_transferId_idx" ON "StockMovement"("transferId");

-- CreateIndex
CREATE INDEX "Shift_branchId_openedAt_idx" ON "Shift"("branchId", "openedAt");

-- CreateIndex
CREATE INDEX "Shift_branchId_status_idx" ON "Shift"("branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_id_branchId_key" ON "Shift"("id", "branchId");

-- CreateIndex
CREATE INDEX "CashMovement_shiftId_idx" ON "CashMovement"("shiftId");

-- CreateIndex
CREATE INDEX "CashMovement_branchId_createdAt_idx" ON "CashMovement"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_branchId_businessDate_idx" ON "Order"("branchId", "businessDate");

-- CreateIndex
CREATE INDEX "Order_branchId_status_idx" ON "Order"("branchId", "status");

-- CreateIndex
CREATE INDEX "Order_branchId_fulfillment_idx" ON "Order"("branchId", "fulfillment");

-- CreateIndex
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_shiftId_idx" ON "Order"("shiftId");

-- CreateIndex
CREATE INDEX "Order_reservationId_idx" ON "Order"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_branchId_number_key" ON "Order"("branchId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Order_id_branchId_key" ON "Order"("id", "branchId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItemModifier_orderItemId_modifierOptionId_key" ON "OrderItemModifier"("orderItemId", "modifierOptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_gatewayReference_key" ON "Payment"("gatewayReference");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_branchId_createdAt_idx" ON "Payment"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_shiftId_idx" ON "Payment"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_orderId_key" ON "Refund"("orderId");

-- CreateIndex
CREATE INDEX "Refund_branchId_createdAt_idx" ON "Refund"("branchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_orderId_branchId_key" ON "Refund"("orderId", "branchId");

-- CreateIndex
CREATE INDEX "AuditLog_branchId_createdAt_idx" ON "AuditLog"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesChannel_code_key" ON "SalesChannel"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOption_code_key" ON "PaymentOption"("code");

-- CreateIndex
CREATE INDEX "PromotionBranch_branchId_idx" ON "PromotionBranch"("branchId");

-- CreateIndex
CREATE INDEX "Reservation_branchId_reservedFor_idx" ON "Reservation"("branchId", "reservedFor");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_branchId_code_key" ON "Reservation"("branchId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_id_branchId_key" ON "Reservation"("id", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "CourierService_code_key" ON "CourierService"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_orderId_key" ON "Delivery"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_externalId_key" ON "Delivery"("externalId");

-- CreateIndex
CREATE INDEX "Delivery_branchId_status_idx" ON "Delivery"("branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_orderId_branchId_key" ON "Delivery"("orderId", "branchId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBranch" ADD CONSTRAINT "UserBranch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBranch" ADD CONSTRAINT "UserBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_orderId_branchId_fkey" FOREIGN KEY ("orderId", "branchId") REFERENCES "Order"("id", "branchId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBranch" ADD CONSTRAINT "ProductBranch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBranch" ADD CONSTRAINT "ProductBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierOption" ADD CONSTRAINT "ModifierOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductModifierGroup" ADD CONSTRAINT "ProductModifierGroup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductModifierGroup" ADD CONSTRAINT "ProductModifierGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ModifierGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStock" ADD CONSTRAINT "InventoryStock_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStock" ADD CONSTRAINT "InventoryStock_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_modifierOptionId_fkey" FOREIGN KEY ("modifierOptionId") REFERENCES "ModifierOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_branchId_inventoryItemId_fkey" FOREIGN KEY ("branchId", "inventoryItemId") REFERENCES "InventoryStock"("branchId", "inventoryItemId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_orderId_branchId_fkey" FOREIGN KEY ("orderId", "branchId") REFERENCES "Order"("id", "branchId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_deviceId_branchId_fkey" FOREIGN KEY ("deviceId", "branchId") REFERENCES "Device"("id", "branchId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_shiftId_branchId_fkey" FOREIGN KEY ("shiftId", "branchId") REFERENCES "Shift"("id", "branchId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_deviceId_branchId_fkey" FOREIGN KEY ("deviceId", "branchId") REFERENCES "Device"("id", "branchId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_shiftId_branchId_fkey" FOREIGN KEY ("shiftId", "branchId") REFERENCES "Shift"("id", "branchId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_discountApprovedById_fkey" FOREIGN KEY ("discountApprovedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "SalesChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_reservationId_branchId_fkey" FOREIGN KEY ("reservationId", "branchId") REFERENCES "Reservation"("id", "branchId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemModifier" ADD CONSTRAINT "OrderItemModifier_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemModifier" ADD CONSTRAINT "OrderItemModifier_modifierOptionId_fkey" FOREIGN KEY ("modifierOptionId") REFERENCES "ModifierOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_branchId_fkey" FOREIGN KEY ("orderId", "branchId") REFERENCES "Order"("id", "branchId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_shiftId_branchId_fkey" FOREIGN KEY ("shiftId", "branchId") REFERENCES "Shift"("id", "branchId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paymentOptionId_fkey" FOREIGN KEY ("paymentOptionId") REFERENCES "PaymentOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_branchId_fkey" FOREIGN KEY ("orderId", "branchId") REFERENCES "Order"("id", "branchId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_shiftId_branchId_fkey" FOREIGN KEY ("shiftId", "branchId") REFERENCES "Shift"("id", "branchId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionBranch" ADD CONSTRAINT "PromotionBranch_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionBranch" ADD CONSTRAINT "PromotionBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_orderId_branchId_fkey" FOREIGN KEY ("orderId", "branchId") REFERENCES "Order"("id", "branchId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_courierServiceId_fkey" FOREIGN KEY ("courierServiceId") REFERENCES "CourierService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Banner" ADD CONSTRAINT "Banner_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
-- Constraint yang belum bisa ditulis di schema.prisma
-- =====================================================================

-- Resep (BoM) milik tepat satu: produk ATAU opsi modifier.
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_exactly_one_owner_check"
  CHECK (num_nonnulls("productId", "modifierOptionId") = 1);

-- Pengaturan pusat hanya satu baris.
ALTER TABLE "OrganizationSetting" ADD CONSTRAINT "OrganizationSetting_singleton_check"
  CHECK ("id" = 1);

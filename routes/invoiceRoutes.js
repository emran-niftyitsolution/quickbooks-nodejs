const express = require("express");
const router = express.Router();
const QuickBooks = require("node-quickbooks");
const OAuthClient = require("intuit-oauth");

// Helper function to initialize QuickBooks client
const initializeQBO = (oauthClient) => {
  const authResponse = oauthClient.getToken();
  const { realmId, access_token, refresh_token } = authResponse;

  return new QuickBooks(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    access_token,
    false,
    realmId,
    process.env.ENVIRONMENT === "sandbox",
    true,
    null,
    "2.0",
    refresh_token
  );
};

// Helper function to find or create customer
const findOrCreateCustomer = async (qbo, customerData) => {
  return new Promise((resolve, reject) => {
    // Search for customer by company name
    qbo.findCustomers(
      [{ field: "CompanyName", value: customerData.company, operator: "=" }],
      (err, customers) => {
        if (err) return reject(err);

        if (
          customers &&
          customers.QueryResponse &&
          customers.QueryResponse.Customer &&
          customers.QueryResponse.Customer.length > 0
        ) {
          // Customer found
          resolve(customers.QueryResponse.Customer[0]);
        } else {
          // Create new customer
          const newCustomer = {
            CompanyName: customerData.company,
            DisplayName: customerData.company,
            PrimaryEmailAddr: { Address: customerData.email },
            BillAddr: {
              Line1: customerData.billingAddress,
              City: customerData.billingTown,
              CountrySubDivisionCode: customerData.billingState,
              PostalCode: customerData.billingZipCode,
            },
            ShipAddr: {
              Line1: customerData.shippingAddress,
              City: customerData.shippingTown,
              CountrySubDivisionCode: customerData.shippingState,
              PostalCode: customerData.shippingZipCode,
            },
          };

          qbo.createCustomer(newCustomer, (err, customer) => {
            if (err) return reject(err);
            resolve(customer);
          });
        }
      }
    );
  });
};

// Helper function to find item by SKU
const findItem = async (qbo, sku) => {
  return new Promise((resolve, reject) => {
    qbo.findItems(
      [{ field: "Sku", value: sku, operator: "=" }],
      (err, items) => {
        if (err) return reject(err);
        if (items && items.QueryResponse && items.QueryResponse.Item) {
          resolve(items.QueryResponse.Item[0]);
        } else {
          resolve(null);
        }
      }
    );
  });
};

// Helper function to authenticate with QuickBooks
const authenticateQBO = async (oauthClient, realmId) => {
  try {
    // Get access token using client credentials
    const authResponse = await oauthClient.clientCredentials({
      scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
      realmId: realmId,
    });

    // Store the tokens
    oauthClient.setToken({
      access_token: authResponse.access_token,
      refresh_token: authResponse.refresh_token,
      token_type: authResponse.token_type,
      expires_in: authResponse.expires_in,
      realmId: realmId,
      createdAt: new Date(),
    });

    return true;
  } catch (error) {
    console.error("❌ Error during authentication:", {
      message: error.message,
      originalMessage: error.originalMessage,
      intuit_tid: error.intuit_tid,
    });
    throw error;
  }
};

// Create invoice route
router.post("/invoices/create", async (req, res) => {
  console.log("📝 Creating New Invoice");
  console.log("📦 Request Body:", req.body);

  try {
    const oauthClient = req.app.get("oauthClient");
    const isTokenValid = oauthClient.isAccessTokenValid();
    console.log("🚀 ~ router.post ~ isTokenValid:", isTokenValid);

    if (!isTokenValid) {
      console.log("⚠️ Token invalid or expired");
      return res.status(401).json({
        error: "Authentication required",
        message: "Please visit /auth endpoint to authenticate with QuickBooks",
      });
    }

    const qbo = initializeQBO(oauthClient);

    // Find or create customer
    const customer = await findOrCreateCustomer(qbo, req.body);
    console.log("👤 Customer processed:", customer.Id);

    // Process line items
    const lineItems = await Promise.all(
      req.body.lineItems.map(async (item) => {
        const qboItem = await findItem(qbo, item.sku);

        if (!qboItem) {
          console.log(`⚠️ Item with SKU ${item.sku} not found`);
          throw new Error(`Item with SKU ${item.sku} not found`);
        }

        return {
          Amount: parseFloat(item.totalAmount),
          DetailType: "SalesItemLineDetail",
          Description: item.description,
          SalesItemLineDetail: {
            ItemRef: {
              value: qboItem.Id,
              name: qboItem.Name,
            },
            Qty: parseInt(item.quantity),
            UnitPrice: parseFloat(item.unitPrice),
          },
        };
      })
    );

    // Create invoice object
    const invoiceData = {
      CustomerRef: {
        value: customer.Id,
      },
      BillEmail: {
        Address: req.body.email,
      },
      ShipDate: req.body.shippingDate,
      Line: lineItems,
      BillAddr: {
        Line1: req.body.billingAddress,
        City: req.body.billingTown,
        CountrySubDivisionCode: req.body.billingState,
        PostalCode: req.body.billingZipCode,
      },
      ShipAddr: {
        Line1: req.body.shippingAddress,
        City: req.body.shippingTown,
        CountrySubDivisionCode: req.body.shippingState,
        PostalCode: req.body.shippingZipCode,
      },
    };

    // Create invoice
    qbo.createInvoice(invoiceData, (err, invoice) => {
      if (err) {
        console.error("❌ Error creating invoice:", err);
        return res
          .status(500)
          .json({ error: "Failed to create invoice", details: err.message });
      }

      console.log("✅ Invoice created successfully:", invoice.Id);
      res.status(201).json({
        success: true,
        message: "Invoice created successfully",
        invoice: invoice,
      });
    });
  } catch (error) {
    console.error("❌ Error in invoice creation:", error);
    res.status(500).json({
      error: "Failed to create invoice",
      details: error.message,
    });
  }
});

module.exports = router;

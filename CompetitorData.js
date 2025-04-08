const mongoose = require("mongoose");

const CompetitorDataSchema = new mongoose.Schema(
  {
    date: String,
    inputId: String,
    userEmail: String,
    merchandiserName: String,
    outlet: String,
    store: String,
    company: String,
    brand: String,
    promotionalType: String,
    promotionalTypeDetails: String,
    displayLocation: String,
    pricing: String,
    durationOfPromo: String,
    impactToOurProduct: String,
    customerFeedback: String,
  },
  {
    collection: "Competitors",
  }
);

mongoose.model("Competitors", CompetitorDataSchema);

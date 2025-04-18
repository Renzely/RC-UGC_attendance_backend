const mongoose = require("mongoose");

const QTTScoringSchema = new mongoose.Schema(
  {
    userEmail: String,
    inputId: String,
    date: String,
    merchandiserName: String,
    outlet: String,
    selectedType: String,
    selectedAnswers: { type: Object, default: {} },
    beforeImage: String,
    afterImage: String,
  },
  {
    collection: "QTTScoring",
  }
);

mongoose.model("QTTScoring", QTTScoringSchema);

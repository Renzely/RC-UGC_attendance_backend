// const mongoose = require("mongoose");

// const ParcelDataSchema = new mongoose.Schema(
//   {
//     date: String,
//     inputId: String,
//     name: String,
//     UserEmail: String,
//     accountNameBranchManning: String,
//     period: String,
//     month: String,
//     week: String,
//     category: String,
//     skuDescription: String,
//     skuCode: Number,
//     products: String,
//     status: String,
//     beginning: Number,
//     delivery: Number,
//     ending: Number,
//     offtake: Number,
//     inventoryDayslevel: Number,
//     noOfDaysOOS: Number,
//     remarksOOS: String,
//     reasonOOS: String,
//     expiryFields: [
//       {
//         type: Map,  // Define each item in the array as a Map with keys and values
//         of: mongoose.Schema.Types.Mixed,  // Can store mixed types (strings, numbers, etc.)
//       }
//     ],
//   },
//   {
//     collection: "TowiInventory",
//   }
// );

// mongoose.model("TowiInventory", ParcelDataSchema);

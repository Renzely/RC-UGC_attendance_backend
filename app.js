const express = require("express");
const app = express();
const mongoose = require("mongoose");
require("./UserDetails");
// require("./AttendanceDetails");
// require("./ParcelDetails");
// require("./AttendanceInput");
// require("./ParcelInput");
// require("./CoorDetails");
// require("./InventoryData");
// require("./RtvData");
require("./HistoryAttendance");
// require("./status")
const AWS = require("aws-sdk");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

app.use(express.json());

var cors = require("cors");
const { status, type, append } = require("express/lib/response");
app.use(cors());

const mongoURI =
  "mongodb+srv://RCUGCuser:RCUGCpass@towi.v2djp3n.mongodb.net/RC%26UGC?retryWrites=true&w=majority&appName=TOWI";

const User = mongoose.model("UserDb");

const Attendance = mongoose.model("Attendance");

// const BranchSKU = mongoose.model("BranchSKU");

// const Attendance = mongoose.model("attendances");

// const Coordinator = mongoose.model("TowiCoordinator")

// const RTV = mongoose.model("TowiReturnToVendor");

// const Parcel = mongoose.model("Towiinventory");

// const AttendanceInput = mongoose.model("attendanceInput");

// const ParcelInput = mongoose.model("parcelInput");

// const ParcelData = mongoose.model("TowiInventory");

const JWT_SECRET = "asdfghjklzxcvbnmqwertyuiop";

mongoose
  .connect(mongoURI)
  .then(() => {
    console.log("Database Connected successfully");
  })
  .catch((e) => {
    console.log(e);
  });

app.get("/", (req, res) => {
  res.send({ status: "started" });
});

app.post("/get-users-by-branch", async (req, res) => {
  const { branches } = req.body; // Expecting an array of branches
  console.log("Received branches:", branches);

  try {
    // Fetch users with branches matching any in the provided list
    const users = await User.find({
      $or: branches.map((branch) => ({
        accountNameBranchManning: { $regex: `\\b${branch}\\b`, $options: "i" }, // Match branch case-insensitively
      })),
    });

    const expandedUsers = users.flatMap((user) => {
      const branchesForUser = Array.isArray(user.accountNameBranchManning)
        ? user.accountNameBranchManning
        : user.accountNameBranchManning
            .split(",")
            .map((branch) => branch.trim());

      return branchesForUser
        .filter((userBranch) => branches.includes(userBranch)) // Only include matched branches
        .map((branch) => ({
          ...user.toObject(),
          branch,
        }));
    });

    // Remove duplicates based on both username and branch
    const uniqueUsers = Array.from(
      new Map(
        expandedUsers.map((user) => [`${user.username}-${user.branch}`, user]) // Combine `username` and `branch` as the unique key
      ).values()
    );

    console.log("Unique Users:", uniqueUsers);

    // Send response with the filtered users, or an error if no users found
    if (uniqueUsers.length === 0) {
      return res.status(404).json({
        status: 404,
        message: "No users found for the given branches",
      });
    }

    return res.status(200).json({ status: 200, users: uniqueUsers });
  } catch (error) {
    console.error("Error fetching users:", error);
    return res.status(500).json({ error: "Error fetching users" });
  }
});

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

// Endpoint to generate pre-signed URL
app.post("/save-attendance-images", (req, res) => {
  const { fileName } = req.body;

  // Set S3 parameters
  const params = {
    Bucket: "attendance-images-rc",
    Key: fileName,
    Expires: 60, // URL expiration time (in seconds)
    ContentType: "image/jpeg", // Or the file type you're uploading
  };

  // Generate the pre-signed URL
  s3.getSignedUrl("putObject", params, (err, url) => {
    if (err) {
      return res
        .status(500)
        .json({ error: "Failed to generate pre-signed URL" });
    }

    // Send the URL to the client
    res.json({ url });
  });
});

app.post("/get-all-attendance", async (req, res) => {
  const { userEmail } = req.body;

  try {
    User.aggregate([
      {
        $match: {
          userEmail: userEmail,
        },
      },
    ]).then((data) => {
      return res.send({ status: 200, data: data });
    });
  } catch (error) {
    return res.send({ error: error });
  }
});

app.post("/get-attendance", async (req, res) => {
  try {
    const { userEmail } = req.body;
    console.log("Received request for userEmail:", userEmail);

    // Fetch all attendance records for the user, sorted by date in descending order
    const attendanceRecords = await Attendance.find({ userEmail }).sort({
      date: 1,
    });

    if (!attendanceRecords.length) {
      console.log("No attendance found for user:", userEmail);
      return res.json({ success: true, data: [] });
    }

    // Log the raw data to inspect the time coordinates
    console.log(
      "Fetched Attendance Records:",
      JSON.stringify(attendanceRecords, null, 2)
    );

    const result = attendanceRecords.map((attendance) => ({
      date: attendance.date,
      accountNameBranchManning: attendance.accountNameBranchManning || "",
      timeLogs: attendance.timeLogs.map((log) => {
        // Log each time log coordinates
        console.log("Time In Coordinates:", log.time_in_coordinates);
        console.log("Time Out Coordinates:", log.time_out_coordinates);

        return {
          timeIn: log.timeIn,
          timeOut: log.timeOut,
          timeInLocation: log.timeInLocation || "No location provided",
          timeOutLocation: log.timeOutLocation || "No location provided",
          timeInCoordinates: log.time_in_coordinates || {
            latitude: 0,
            longitude: 0,
          },
          timeOutCoordinates: log.time_out_coordinates || {
            latitude: 0,
            longitude: 0,
          },
          selfieUrl: log.selfieUrl || "", // Time-in selfie URL
          timeOutSelfieUrl: log.timeOutSelfieUrl || "", // Time-out selfie URL
        };
      }),
    }));

    console.log("Formatted Attendance Data:", JSON.stringify(result, null, 2));
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("Error in /get-attendance:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// app.get('/get-skus-by-status', async (req, res) => {
//   const { branch, statusCategory, status } = req.query;

//   if (!branch || !statusCategory || !status) {
//     return res.status(400).json({ message: 'Branch, Category, and Status are required' });
//   }

//   try {
//     const branchData = await BranchSKU.findOne({
//       accountNameBranchManning: branch,
//       category: statusCategory
//     });

//     if (!branchData) {
//       return res.status(404).json({ message: 'Branch or Category not found' });
//     }

//     // Filter SKUs where `enabled` is false and status matches the provided status
//     const skus = branchData.SKUs.filter(sku =>
//       !sku.enabled && sku.status === status
//     );

//     res.status(200).json(skus);
//   } catch (error) {
//     console.error('Error fetching SKUs:', error);
//     res.status(500).json({ message: 'Internal server error' });
//   }
// });

app.post("/export-attendance-data", async (req, res) => {
  const { start, end } = req.body;

  try {
    console.log("Received request for export data with dates:", start, end);

    const data = await mongoose.model("TowiAttendances").aggregate([
      // Match documents within the specified date range
      {
        $match: {
          date: {
            $gte: new Date(start),
            $lt: new Date(end),
          },
        },
      },
      // Optionally join with another collection if needed
      {
        $lookup: {
          from: "users",
          localField: "userEmail",
          foreignField: "email",
          as: "user_details",
        },
      },
      // Flatten the structure by merging user details into the root object
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [{ $arrayElemAt: ["$user_details", 0] }, "$$ROOT"],
          },
        },
      },
      // Select and rename fields for the output
      {
        $project: {
          date: 1,
          userEmail: 1,
          accountNameBranchManning: 1,
          timeLogs: {
            $map: {
              input: "$timeLogs",
              as: "log",
              in: {
                timeIn: "$$log.timeIn",
                timeOut: "$$log.timeOut",
                timeInLocation: "$$log.timeInLocation",
                timeOutLocation: "$$log.timeOutLocation",
              },
            },
          },
          user_first_name: "$first_name",
          user_last_name: "$last_name",
          _id: 0,
        },
      },
      // Sort the output by specific fields
      {
        $sort: {
          date: 1,
          user_first_name: 1,
        },
      },
    ]);

    console.log("Aggregated data:", JSON.stringify(data));

    return res.send({ status: 200, data });
  } catch (error) {
    console.error("Error exporting attendance data:", error);
    return res.status(500).send({ error: error.message });
  }
});

// app.get('/get-skus', async (req, res) => {
//   const { accountNameBranchManning } = req.query;

//   if (!accountNameBranchManning) {
//     return res.status(400).json({ message: 'Branch name is required' });
//   }

//   try {
//     // Find the SKUs associated with the given branch name
//     const skus = await BranchSKU.find({ accountNameBranchManning });

//     if (!skus || skus.length === 0) {
//       return res.status(404).json({ message: 'No SKUs found for this branch' });
//     }

//     // Group SKUs by category and filter out disabled SKUs
//     const skusByCategory = skus.reduce((acc, sku) => {
//       if (!acc[sku.category]) {
//         acc[sku.category] = [];
//       }
//       const enabledSkus = sku.SKUs.filter(skuItem => skuItem.enabled); // Filter enabled SKUs
//       if (enabledSkus.length > 0) {
//         acc[sku.category].push(enabledSkus);
//       }
//       return acc;
//     }, {});

//     res.status(200).json(skusByCategory);
//   } catch (error) {
//     console.error('Error fetching SKUs:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// });

// app.post('/disable-sku', async (req, res) => {
//   const { branch, category, skuDescription, enabled, status } = req.body;

//   try {
//     // Find the branch SKU document
//     const branchSKU = await BranchSKU.findOne({
//       accountNameBranchManning: branch,
//       category: category,
//     });

//     if (!branchSKU) {
//       return res.status(404).json({ message: 'Branch and category not found.' });
//     }

//     // Find the SKU and update its enabled status
//     const sku = branchSKU.SKUs.find(s => s.SKUDescription === skuDescription);
//     if (!sku) {
//       return res.status(404).json({ message: 'SKU not found in this category.' });
//     }

//     sku.status = status; // Add or update the status field
//     sku.enabled = enabled;

//     // Save the updated document
//     await branchSKU.save();

//     res.status(200).json({ message: 'SKU status updated successfully.' });
//   } catch (error) {
//     console.error('Error updating SKU status:', error);
//     res.status(500).json({ message: 'An error occurred while updating SKU status.' });
//   }
// });

// app.post('/enable-sku', async (req, res) => {
//   const { branch, category, skuDescription, enabled, status } = req.body;

//   try {
//     // Find the branch SKU document
//     const branchSKU = await BranchSKU.findOne({
//       accountNameBranchManning: branch,
//       category: category,
//     });

//     if (!branchSKU) {
//       return res.status(404).json({ message: 'Branch and category not found.' });
//     }

//     // Find the SKU and update its enabled status and status field
//     const sku = branchSKU.SKUs.find(s => s.SKUDescription === skuDescription);
//     if (!sku) {
//       return res.status(404).json({ message: 'SKU not found in this category.' });
//     }

//     // Ensure the SKU was previously disabled and its status was either "Not Carried" or "Delisted"
//     if (!sku.enabled && ['Not Carried', 'Delisted'].includes(sku.status)) {
//       sku.status = status; // Update the status field
//       sku.enabled = enabled; // Enable the SKU
//     } else {
//       return res.status(400).json({ message: 'SKU is already enabled or does not meet the criteria for enabling.' });
//     }

//     // Save the updated document
//     await branchSKU.save();

//     res.status(200).json({ message: 'SKU status updated successfully.' });
//   } catch (error) {
//     console.error('Error updating SKU status:', error);
//     res.status(500).json({ message: 'An error occurred while updating SKU status.' });
//   }
// });

// app.post('/delisted-sku', async (req, res) => {
//   const { branch, category, skuDescription, enabled, status } = req.body;

//   try {
//     // Find the branch SKU document
//     const branchSKU = await BranchSKU.findOne({
//       accountNameBranchManning: branch,
//       category: category,
//     });

//     if (!branchSKU) {
//       return res.status(404).json({ message: 'Branch and category not found.' });
//     }

//     // Find the SKU and update its status
//     const sku = branchSKU.SKUs.find(s => s.SKUDescription === skuDescription);
//     if (!sku) {
//       return res.status(404).json({ message: 'SKU not found in this category.' });
//     }

//     sku.enabled = enabled;
//     sku.status = status; // Add or update the status field

//     // Save the updated document
//     await branchSKU.save();

//     res.status(200).json({ message: 'SKU status updated to Delisted successfully.' });
//   } catch (error) {
//     console.error('Error updating SKU status:', error);
//     res.status(500).json({ message: 'An error occurred while updating SKU status.' });
//   }
// });

// app.post('/update-sku-status', async (req, res) => {
//   const { branch, category, status, skuDescription } = req.body;

//   try {
//     // Find the specific branch SKU entry based on the branch and category
//     const branchSKU = await BranchSKU.findOne({
//       accountNameBranchManning: branch,
//       category: category,
//     });

//     // Check if the branch SKU document exists
//     if (!branchSKU) {
//       return res.status(404).json({ message: 'Branch and category not found.' });
//     }

//     // Find the specific SKU within the found branch SKU document
//     const sku = branchSKU.SKUs.find(s => s.SKUDescription === skuDescription);
//     if (!sku) {
//       return res.status(404).json({ message: 'SKU not found in this category.' });
//     }

//     // Update the SKU status
//     sku.status = status;
//     sku.enabled = status === 'Not Carried' || status === 'Delisted' ? false : true; // Update SKU enabled state based on status

//     // Save the updated branch SKU document
//     await branchSKU.save();

//     res.status(200).json({ message: 'SKU status updated successfully.' });
//   } catch (error) {
//     console.error('Error updating SKU status:', error);
//     res.status(500).json({ message: 'An error occurred while updating SKU status.' });
//   }
// });

// app.post('/save-branch-sku', async (req, res) => {
//   try {
//     const { accountNameBranchManning, category, skus } = req.body;

//     console.log('Received data:', { accountNameBranchManning, category, skus });

//     if (!accountNameBranchManning || !category || !skus || !Array.isArray(skus)) {
//       return res.status(400).json({ error: 'Invalid request data' });
//     }

//     // Upsert operation: If a document with the same branch and category exists, update it. Otherwise, create a new one.
//     const result = await BranchSKU.updateOne(
//       { accountNameBranchManning, category }, // Filter condition
//       { $addToSet: { SKUs: { $each: skus } } }, // Add SKUs to the array, avoiding duplicates
//       { upsert: true } // Create a new document if no matching document is found
//     );

//     console.log('Update result:', result);

//     res.status(201).json({ message: 'BranchSKUs saved successfully', data: result });
//   } catch (error) {
//     console.error('Error saving BranchSKUs:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });

app.post("/register-user-admin", async (req, res) => {
  const {
    firstName,
    middleName,
    lastName,
    emailAddress,
    contactNum,
    password,
    roleAccount,
    accountNameBranchManning,
  } = req.body;

  try {
    const encryptedPassword = await bcrypt.hash(password, 8);
    const oldUser = await User.findOne({ emailAddress: emailAddress });

    if (oldUser) {
      return res
        .status(400)
        .send({ status: "error", data: "User already exists!" });
    }

    const dateNow = new Date();
    let type;

    if (roleAccount === "Coordinator") {
      type = 2;
    } else {
      type = 3;
    }

    const newUser = await User.create({
      roleAccount,
      accountNameBranchManning,
      firstName,
      middleName,
      lastName,
      emailAddress,
      contactNum,
      password: encryptedPassword,
      isActivate: false,
      j_date: dateNow,
      type: type,
    });

    if (roleAccount === "Coordinator") {
      await Coordinator.create({
        coorEmailAdd: emailAddress,
        MerchandiserEmail: [],
      });
    }

    res.status(200).send({ status: 200, data: "User Created" });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).send({ status: "error", data: error.message });
  }
});

app.post("/get-admin-user", async (req, res) => {
  try {
    const data = await User.aggregate([
      {
        $match: { $or: [{ type: { $eq: 2 } }, { type: { $eq: 3 } }] },
      },

      {
        $project: {
          accountNameBranchManning: 1,
          roleAccount: 1,
          firstName: 1,
          middleName: 1,
          lastName: 1,
          emailAddress: 1,
          contactNum: 1,
          isActivate: 1,
          // "j_date" : 1,
        },
      },
    ]);

    return res.send({ status: 200, data: data });
  } catch (error) {
    return res.send({ error: error });
  }
});

app.post("/login-admin", async (req, res) => {
  const { emailAddress, password } = req.body;
  const oldUser = await User.findOne({ emailAddress: emailAddress });

  if (!oldUser)
    return res.send({ status: 401, data: "Invalid email or password" });

  if (!oldUser.type === 2)
    return res.send({ status: 401, data: "Invalid User." });

  if (oldUser.isActivate === false)
    return res.send({ status: 401, data: "User is already deactivated." });

  if (await bcrypt.compare(password, oldUser.password)) {
    const token = jwt.sign({ emailAddress: oldUser.emailAddress }, JWT_SECRET);

    if (res.status(201)) {
      return res.send({
        status: 200,
        data: {
          token,
          emailAddress: oldUser.emailAddress,
          firstName: oldUser.firstName,
          middleName: oldUser.middleName,
          lastName: oldUser.lastName,
          contactNum: oldUser.contactNum,
          roleAccount: oldUser.roleAccount,
          accountNameBranchManning: oldUser.accountNameBranchManning, // Include roleAccount in the response
        },
      });
    } else {
      return res.send({ error: "error" });
    }
  } else {
    return res.send({ status: 401, data: "Invalid user or password" });
  }
});

app.put("/update-status", async (req, res) => {
  const { isActivate, emailAddress } = req.body;

  const userEmail = emailAddress;
  console.log(userEmail);
  try {
    await User.findOneAndUpdate(
      { emailAddress: userEmail },
      { $set: { isActivate: isActivate } }
    );
    res.send({ status: 200, data: "Status updated" });
  } catch (error) {
    res.send({ status: "errorr", data: error });
  }
});

app.post("/user-data", async (req, res) => {
  const { token } = req.body;

  try {
    const user = jwt.verify(token, JWT_SECRET);
    const userEmail = user.email;

    User.findOne({ email: userEmail }).then((data) => {
      return res.send({ status: 200, data: data });
    });
  } catch (error) {
    return res.send({ error: error });
  }
});

app.put("/update-user-branch", async (req, res) => {
  const { emailAddress, branches } = req.body;

  try {
    // Update the user's branches based on the provided email
    await mongoose
      .model("UserDb")
      .findOneAndUpdate(
        { emailAddress: emailAddress },
        { $set: { accountNameBranchManning: branches } }
      );

    res
      .status(200)
      .send({ status: 200, message: "User branches updated successfully" });
  } catch (error) {
    res.status(500).send({ status: 500, error: error.message });
  }
});

app.post("/update-coor-details", async (req, res) => {
  try {
    const { emails, coorEmailAdd } = req.body;

    // Validate input
    if (
      !Array.isArray(emails) ||
      emails.some((email) => typeof email !== "string")
    ) {
      return res
        .status(400)
        .send({ status: 400, message: "Invalid emails format" });
    }

    if (typeof coorEmailAdd !== "string") {
      return res
        .status(400)
        .send({ status: 400, message: "Invalid coordinator email format" });
    }

    // Find the existing CoorDetails document using the filter
    const coorDetails = await CoorDetails.findOne({ coorEmailAdd });

    if (!coorDetails) {
      return res
        .status(404)
        .send({ status: 404, message: "CoorDetails document not found" });
    }

    // Update the document with the new emails
    coorDetails.merchandiserHandle = emails.map((email) => ({
      MerchandiserEmail: email,
    }));

    await coorDetails.save();

    return res.send({
      status: 200,
      message: "CoorDetails updated successfully",
    });
  } catch (error) {
    console.error("Error in /update-coor-details:", error);
    return res.status(500).send({ status: 500, message: error.message });
  }
});

app.post("/get-all-merchandiser", async (req, res) => {
  try {
    User.aggregate([
      {
        $match: {
          type: 1,
        },
      },

      {
        $project: {
          firstName: 1,
          middleName: 1,
          lastName: 1,
          emailAddress: 1,
          contactNum: 1,
          isActivate: 1,
          remarks: 1,
          accountNameBranchManning: 1,
          // "j_date" : 1,
        },
      },
    ]).then((data) => {
      return res.send({ status: 200, data: data });
    });
  } catch (error) {
    return res.send({ error: error });
  }
});

app.post("/get-all-user", async (req, res) => {
  try {
    User.aggregate([
      {
        $match: {
          type: 1,
        },
      },

      {
        $project: {
          firstName: 1,
          middleName: 1,
          lastName: 1,
          emailAddress: 1,
          contactNum: 1,
          isActivate: 1,
          remarks: 1,
          accountNameBranchManning: 1,
          username: 1,
          // "j_date" : 1,
        },
      },
    ]).then((data) => {
      return res.send({ status: 200, data: data });
    });
  } catch (error) {
    return res.send({ error: error });
  }
});

app.post("/view-user-attendance", async (req, res) => {
  const { user } = req.body;

  const userEmail = user;

  try {
    console.log(userEmail, "user check");
    await Attendance.findOne({ user: userEmail }).then((data) => {
      return res.send({ status: 200, data: data.attendance });
    });
  } catch (error) {
    return res.send({ error: error });
  }
});

// app.post("/test-index", async (req, res) => {
//   const { user } = req.body;

//   const userEmail = user;

//   try {
//     console.log(userEmail, "user check");
//     await Parcel.find()
//       .count()
//       .then((data) => {
//         return res.send({ status: 200, data: data });
//       });
//   } catch (error) {
//     return res.send({ error: error });
//   }
// });

// app.post("/retrieve-parcel-data", async (req, res) => {

//   try {
//     const parcelPerUser = await ParcelData.find();

//     console.log("Found parcels:", parcelPerUser);
//     return res.status(200).json({ status: 200, data: parcelPerUser });
//   } catch (error) {
//     return res.send({ error: error });
//   }
// });

// app.post("/filter-date-range", async (req, res) => {
//   const { startDate, endDate } = req.body; // Expect startDate and endDate in the request body
//   console.log("Filter range:", { startDate, endDate });

//   try {
//     // Fetch parcels where the date is within the range
//     const parcelsInRange = await ParcelData.find({
//       date: { $gte: startDate, $lte: endDate },
//     });

//     console.log("Found parcels in range:", parcelsInRange);
//     return res.status(200).json({ status: 200, data: parcelsInRange });
//   } catch (error) {
//     console.error("Error fetching parcels:", error);
//     return res.status(500).send({ error: "Internal Server Error" });
//   }
// });

// app.post("/retrieve-parcel-data", async (req, res) => {
//   try {
//     const { branches } = req.body; // Get the branch list from the request body

//     if (!branches || !Array.isArray(branches)) {
//       return res.status(400).json({ status: 400, message: "Invalid branch data" });
//     }

//     // Find parcels that match the provided branches
//     const parcelPerUser = await ParcelData.find({
//       accountNameBranchManning: { $in: branches }
//     });

//     console.log("Filtered parcels:", parcelPerUser);
//     return res.status(200).json({ status: 200, data: parcelPerUser });
//   } catch (error) {
//     console.error("Error retrieving parcels:", error);
//     return res.status(500).json({ status: 500, error: "Server error" });
//   }
// });

// app.post("/retrieve-RTV-data", async (req, res) => {
//   const { branches } = req.body; // Get branches from request body

//   if (!branches || !Array.isArray(branches)) {
//     return res.status(400).json({ status: 400, message: "Invalid branch data" });
//   }

//   try {
//     const rtvData = await RTV.find({
//       outlet: { $in: branches }, // Filter by branches
//     });

//     console.log("Filtered RTV data:", rtvData);
//     return res.status(200).json({ status: 200, data: rtvData });
//   } catch (error) {
//     console.error("Error retrieving RTV data:", error);
//     return res.status(500).json({ status: 500, message: "Server error" });
//   }
// });

// app.post("/export-inventory-data-towi", async (req, res) => {
//   const { start, end } = req.body;

//   try {
//       const data = await mongoose.model("TowiInventory").aggregate([
//           // Match documents within the specified date range
//           {
//               $match: {
//                   $expr: {
//                       $and: [
//                           { $gte: [{ $toDate: "$date" }, new Date(start)] },
//                           { $lt: [{ $toDate: "$date" }, new Date(end)] }
//                       ]
//                   }
//               }
//           },
//           // Optionally join with another collection if needed
//           {
//               $lookup: {
//                   from: "users",
//                   localField: "UserEmail", // Adjust field to match schema
//                   foreignField: "email",
//                   as: "user_details"
//               }
//           },
//           // Flatten the structure by merging user details into the root object
//           {
//               $replaceRoot: {
//                   newRoot: {
//                       $mergeObjects: [
//                           { $arrayElemAt: ["$user_details", 0] },
//                           "$$ROOT"
//                       ]
//                   }
//               }
//           },
//           // Select and rename fields for the output
//           {
//             $project: {
//                 date: 1,
//                 name: 1,
//                 inputId: 1,
//                 UserEmail: 1,
//                 accountNameBranchManning: 1,
//                 period: 1,
//                 month: 1,
//                 week: 1,
//                 skuDescription: 1,
//                 skuCode: 1,
//                 status: 1,
//                 beginningSA: 1,
//                 beginningWA: 1,
//                 beginning: 1,
//                 delivery: 1,
//                 endingSA: 1,
//                 endingWA: 1,
//                 ending: 1,
//                 expiryFields: {
//                     $map: {
//                         input: "$expiryFields",
//                         as: "expiry",
//                         in: {
//                           expiryMonth: "$$expiry.expiryMonth",
//                           expiryPcs: "$$expiry.expiryPcs" // Example keys
//                         }
//                     }
//                 },
//                 offtake: 1,
//                 inventoryDaysLevel: { $round: ["$inventoryDaysLevel", 2] }, // Round to 2 decimals
//                 noOfDaysOOS: 1,
//                 remarksOOS: 1,
//                 "user_first_name": "$first_name",
//                 "user_last_name": "$last_name",
//                 _id: 0
//             }
//         },

//           // Sort the output by specific fields
//           {
//               $sort: {
//                   date: 1, // Sort by date in ascending order
//                   "user_first_name": 1
//               }
//           }
//       ]);

//       return res.send({ status: 200, data });
//   } catch (error) {
//       return res.status(500).send({ error: error.message });
//   }
// });

// app.post("/export-RTV-data", async (req, res) => {
//   const { start, end } = req.body;

//   try {
//       const data = await mongoose.model("TowiReturnToVendor").aggregate([
//           // Match documents within the specified date range
//           {
//               $match: {
//                   $expr: {
//                       $and: [
//                           { $gte: [{ $toDate: "$date" }, new Date(start)] },
//                           { $lt: [{ $toDate: "$date" }, new Date(end)] }
//                       ]
//                   }
//               }
//           },
//           // Optionally join with another collection if needed
//           {
//               $lookup: {
//                   from: "users",
//                   localField: "UserEmail", // Adjust field to match schema
//                   foreignField: "email",
//                   as: "user_details"
//               }
//           },
//           // Flatten the structure by merging user details into the root object
//           {
//               $replaceRoot: {
//                   newRoot: {
//                       $mergeObjects: [
//                           { $arrayElemAt: ["$user_details", 0] },
//                           "$$ROOT"
//                       ]
//                   }
//               }
//           },
//           // Select and rename fields for the output
//           {
//             $project: {
//                 date: 1,
//                 merchandiserName: 1,
//                 inputId: 1,
//                 UserEmail: 1,
//                 outlet: 1,
//                 category: 1,
//                 item: 1,
//                 quantity: 1,
//                 driverName: 1,
//                 plateNumber: 1,
//                 pullOutReason: 1,
//             }
//         },

//           // Sort the output by specific fields
//           {
//               $sort: {
//                   date: 1, // Sort by date in ascending order
//                   "user_first_name": 1
//               }
//           }
//       ]);

//       return res.send({ status: 200, data });
//   } catch (error) {
//       return res.status(500).send({ error: error.message });
//   }
// });

// app.post("/filter-RTV-data", async (req, res) => {
//   const { selectDate, branches } = req.body; // Get date and branches from request body

//   if (!branches || !Array.isArray(branches)) {
//     return res.status(400).json({ status: 400, message: "Invalid branch data" });
//   }

//   try {
//     const rtvData = await RTV.find({
//       date: { $eq: selectDate },
//       outlet: { $in: branches }, // Filter by branches
//     });

//     console.log("Filtered RTV data by date and branches:", rtvData);
//     return res.status(200).json({ status: 200, data: rtvData });
//   } catch (error) {
//     console.error("Error filtering RTV data:", error);
//     return res.status(500).json({ status: 500, message: "Server error" });
//   }
// });

const transporter = nodemailer.createTransport({
  pool: true,
  service: "gmail",
  host: "smtp.gmail.com",
  port: 465,
  secure: true, // Use `true` for port 465, `false` for all other ports
  auth: {
    user: process.env.Email,
    pass: process.env.Pass,
  },
});

app.post("/send-otp-register", async (req, res) => {
  const { email } = req.body;

  try {
    var code = Math.floor(100000 + Math.random() * 900000);
    code = String(code);
    code = code.substring(0, 4);

    const info = await transporter.sendMail({
      from: {
        name: "BMPower",
        address: process.env.email,
      },
      to: email,
      subject: "OTP code",
      html:
        "<b>Your OTP code is</b> " +
        code +
        "<b>. Do not share this code with others.</b>",
    });

    return res.send({ status: 200, code: code });
  } catch (error) {
    return res.send({ error: error.message });
  }
});

app.put("/forgot-password-reset", async (req, res) => {
  const { password, emailAddress } = req.body;

  const encryptedPassword = await bcrypt.hash(password, 8);

  const userEmail = emailAddress;
  console.log(userEmail);
  try {
    await User.findOneAndUpdate(
      { emailAddress: userEmail },
      { $set: { password: encryptedPassword } }
    );
    res.send({ status: 200, data: "Password updated" });
  } catch (error) {
    res.send({ status: "error", data: error });
  }
});

app.post("/send-otp-forgotpassword", async (req, res) => {
  const { emailAddress } = req.body;

  const oldUser = await User.findOne({ emailAddress: emailAddress });

  if (!oldUser) {
    return res.status(404).json({ error: "Email does not exist" });
  }

  try {
    var code = Math.floor(100000 + Math.random() * 900000);
    code = String(code);
    code = code.substring(0, 4);

    const info = await transporter.sendMail({
      from: {
        name: "BMPower",
        address: process.env.Email,
      },
      to: emailAddress,
      subject: "OTP code",
      html:
        "<b>Your OTP code is</b> " +
        code +
        "<b>. Do not share this code with others.</b>",
    });

    return res.status(200).json({
      status: 200,
      data: info,
      emailAddress: emailAddress,
      code: code,
    });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ error: "Failed to send OTP. Please try again." });
  }
});

app.listen(8080, () => {
  console.log("node js server started");
});

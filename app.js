const express = require("express");
const app = express();
const mongoose = require("mongoose");
require("./UserDetails");
// require("./AttendanceDetails");
// require("./ParcelDetails");
// require("./AttendanceInput");
require("./CompetitorData");
// require("./CoorDetails");
// require("./InventoryData");
require("./QTTScoringData");
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

const QTTS = mongoose.model("QTTScoring");

const competitorsData = mongoose.model("Competitors");

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

const QTTs3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID_QTT_COMPE,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_QTT_COMPE,
  region: process.env.AWS_REGION_QTT_COMPE,
});

// Endpoint to generate a pre-signed URL for image uploads
app.post("/save-QTTScoring-images", (req, res) => {
  const { fileName } = req.body;

  if (!fileName) {
    return res.status(400).json({ error: "File name is required" });
  }

  const params = {
    Bucket: "qtt-scoring-rc",
    Key: fileName,
    Expires: 300, // URL expiration time (5 minutes)
    ContentType: "image/jpeg", // Adjust based on file type
  };

  QTTs3.getSignedUrl("putObject", params, (err, url) => {
    if (err) {
      console.error("Error generating pre-signed URL:", err);
      return res
        .status(500)
        .json({ error: "Failed to generate pre-signed URL" });
    }
    res.json({ url });
  });
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

  if (oldUser.type !== 3) {
    return res.send({
      status: 401,
      data: "Only admins are allowed to login here.",
    });
  }

  if (!oldUser.isActivate)
    return res.send({ status: 401, data: "User is already deactivated." });

  if (await bcrypt.compare(password, oldUser.password)) {
    const token = jwt.sign({ emailAddress: oldUser.emailAddress }, JWT_SECRET);

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
        accountNameBranchManning: oldUser.accountNameBranchManning,
      },
    });
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

app.post("/filter-date-range", async (req, res) => {
  const { startDate, endDate } = req.body; // Expect startDate and endDate in the request body
  console.log("Filter range:", { startDate, endDate });

  try {
    // Fetch parcels where the date is within the range
    const competitorsDataRange = await competitorsData.find({
      date: { $gte: startDate, $lte: endDate },
    });

    console.log("Found parcels in range:", competitorsDataRange);
    return res.status(200).json({ status: 200, data: competitorsDataRange });
  } catch (error) {
    console.error("Error fetching parcels:", error);
    return res.status(500).send({ error: "Internal Server Error" });
  }
});

app.post("/retrieve-competitor-data", async (req, res) => {
  try {
    const { branches } = req.body;

    console.log("Received branches:", branches);

    // Validate that branches is an array
    if (!branches || !Array.isArray(branches)) {
      return res
        .status(400)
        .json({ status: 400, message: "Invalid branch data" });
    }

    // Retrieve all competitor data for debugging
    const allCompetitorData = await competitorsData.find({});
    console.log("All Competitor Data:", allCompetitorData);

    // Log the regex patterns for matching branches
    const branchPatterns = branches.map(
      (branch) => new RegExp(`^${branch.trim()}$`, "i")
    );
    console.log("Branch regex patterns:", branchPatterns);

    // Find competitors matching the provided branches
    const competitorsdata = await competitorsData.find({
      outlet: {
        $in: branches.map((branch) => new RegExp(branch.trim(), "i")),
      },
    });
    console.log("Competitors data after filtering:", competitorsdata);

    console.log("Filtered Competitor Data:", competitorsdata);

    if (competitorsdata.length === 0) {
      console.warn("No matching competitor data found.");
      return res.status(200).json({ status: 200, data: [] });
    }

    return res.status(200).json({ status: 200, data: competitorsdata });
  } catch (error) {
    console.error("Error retrieving competitors data:", error);
    return res.status(500).json({ status: 500, error: "Server error" });
  }
});

app.post("/retrieve-QTTS-data", async (req, res) => {
  const { branches } = req.body; // Get branches from request body

  if (!branches || !Array.isArray(branches)) {
    return res
      .status(400)
      .json({ status: 400, message: "Invalid branch data" });
  }

  try {
    const rtvData = await QTTS.find({
      outlet: { $in: branches }, // Filter by branches
    });

    console.log("Filtered RTV data:", rtvData);
    return res.status(200).json({ status: 200, data: rtvData });
  } catch (error) {
    console.error("Error retrieving RTV data:", error);
    return res.status(500).json({ status: 500, message: "Server error" });
  }
});

app.post("/export-competitors-data", async (req, res) => {
  const { start, end } = req.body;

  try {
    const data = await mongoose.model("Competitors").aggregate([
      // Match documents within the specified date range
      {
        $match: {
          $expr: {
            $and: [
              { $gte: [{ $toDate: "$date" }, new Date(start)] },
              { $lt: [{ $toDate: "$date" }, new Date(end)] },
            ],
          },
        },
      },
      // Join with user collection to get user details
      {
        $lookup: {
          from: "users",
          localField: "userEmail", // Ensure correct field reference
          foreignField: "email",
          as: "user_details",
        },
      },
      // Merge user details with the main document
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [{ $arrayElemAt: ["$user_details", 0] }, "$$ROOT"],
          },
        },
      },
      // Select and rename fields for the export
      {
        $project: {
          _id: 0,
          id: { $add: [1, "$$ROOT.index"] }, // Ensure unique IDs
          date: 1,
          inputId: 1,
          merchandiserName: 1,
          outlet: 1,
          store: 1,
          company: 1,
          brand: 1,
          promotionalType: 1,
          promotionalTypeDetails: 1,
          displayLocation: 1,
          pricing: 1,
          durationOfPromo: 1,
          impactToOurProduct: 1,
          customerFeedback: 1,
          user_first_name: "$first_name",
          user_last_name: "$last_name",
        },
      },
      // Sort the output by date and merchandiser name
      {
        $sort: {
          date: 1, // Sort by date in ascending order
          merchandiserName: 1,
        },
      },
    ]);

    return res.send({ status: 200, data });
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
});

app.post("/export-PSR-data", async (req, res) => {
  const { start, end } = req.body;
  console.log("Received Request:", { start, end });

  try {
    // Log start and end dates to check what is being sent
    console.log("Start Date:", new Date(start));
    console.log("End Date:", new Date(end));

    // Convert the Unix timestamps (start and end) to a date string in the format YYYY-MM-DD
    const startDate = new Date(start).toISOString().split("T")[0];
    const endDate = new Date(end).toISOString().split("T")[0];
    console.log("Converted Start Date:", startDate);
    console.log("Converted End Date:", endDate);

    const data = await mongoose.model("QTTScoring").aggregate([
      {
        $match: {
          // Ensure both the input date and the database date are compared correctly
          date: { $gte: startDate, $lt: endDate }, // Compare with the date string
          selectedType: "PSR",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "userEmail",
          foreignField: "email",
          as: "user_details",
        },
      },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [{ $arrayElemAt: ["$user_details", 0] }, "$$ROOT"],
          },
        },
      },
      {
        $project: {
          count: { $add: ["$key", 1] },
          date: 1,
          merchandiserName: 1,
          outlet: 1,
          selectedType: 1,
          firstBrand: {
            $ifNull: [
              { $arrayElemAt: [{ $objectToArray: "$selectedAnswers" }, 0] },
              {
                k: "First Brand seen inside with main shelf and headers.",
                v: "No Answer",
              },
            ],
          },
          complianceDOG: {
            $ifNull: [
              { $arrayElemAt: [{ $objectToArray: "$selectedAnswers" }, 1] },
              { k: "Compliance with DOG planogram.", v: "No Answer" },
            ],
          },
          complianceCAT: {
            $ifNull: [
              { $arrayElemAt: [{ $objectToArray: "$selectedAnswers" }, 2] },
              { k: "Compliance with CAT planogram.", v: "No Answer" },
            ],
          },

          beforeImage: { $ifNull: ["$beforeImage", ""] },
          afterImage: { $ifNull: ["$afterImage", ""] },
        },
      },
      {
        $sort: {
          date: 1,
          merchandiserName: 1,
        },
      },
    ]);

    // Log the data to see what is returned from the aggregation query
    console.log("Query Result:", data);

    if (data.length === 0) {
      return res.status(200).send({ status: 200, data: [] }); // No data found
    }

    return res.send({ status: 200, data });
  } catch (error) {
    console.error("Aggregation Error:", error.message);
    return res.status(500).send({ error: error.message });
  }
});

app.post("/export-VET-data", async (req, res) => {
  const { start, end } = req.body;
  console.log("Received Request:", { start, end });

  try {
    const data = await mongoose.model("QTTScoring").aggregate([
      {
        $match: {
          date: { $gte: start, $lt: end }, // Compare as strings
          selectedType: "VET",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "userEmail",
          foreignField: "email",
          as: "user_details",
        },
      },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [{ $arrayElemAt: ["$user_details", 0] }, "$$ROOT"],
          },
        },
      },
      {
        $project: {
          count: { $add: ["$key", 1] },
          date: 1,
          merchandiserName: 1,
          outlet: 1,
          selectedType: 1,
          selectedAnswers: 1, // Include selectedAnswers to log it
          shelfSpace: {
            $ifNull: [
              {
                $getField: {
                  field: "80% Shelf Space.",
                  input: "$selectedAnswers",
                },
              },
              "",
            ],
          },
          designatedRack: {
            $ifNull: [
              {
                $getField: {
                  field: "Designated Rack.",
                  input: "$selectedAnswers",
                },
              },
              "",
            ],
          },
          beforeImage: { $ifNull: ["$beforeImage", ""] },
          afterImage: { $ifNull: ["$afterImage", ""] },
        },
      },
      {
        $sort: {
          date: 1,
          merchandiserName: 1,
        },
      },
    ]);

    console.log("Query Result:", data);

    return res.send({ status: 200, data });
  } catch (error) {
    console.error("Aggregation Error:", error.message);
    return res.status(500).send({ error: error.message });
  }
});

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

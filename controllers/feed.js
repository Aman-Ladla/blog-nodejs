const { validationResult } = require("express-validator");
const path = require("path");
const fs = require("fs");

const io = require("../socket");
const Post = require("../models/post");
const User = require("../models/user");
const user = require("../models/user");

exports.getPosts = (req, res, next) => {
    const page = req.query.page || 1;
    const perPage = 2;
    let totalItems;

    Post.find()
        .countDocuments()
        .then((count) => {
            totalItems = count;
            return Post.find()
                .populate("creator")
                .sort({ createdAt: -1 })
                .skip((page - 1) * perPage)
                .limit(perPage);
        })
        .then((posts) => {
            res.status(200).json({
                message: "Fetched all posts",
                posts: posts,
                totalItems: totalItems,
            });
        })
        .catch((err) => {
            if (!err.statusCode) {
                err.statusCode = 500;
            }
            next(err);
        });
};

exports.createPost = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const err = new Error("Validation failed, entered data is incorrect!");
        err.statusCode = 422;
        throw err;
    }
    if (!req.file) {
        const error = new Error("Could not find image!");
        error.statusCode = 422;
        throw error;
    }
    const imageUrl = req.file.path.replace("\\", "/");
    const title = req.body.title;
    const content = req.body.content;
    let creator;
    const post = new Post({
        title: title,
        content: content,
        imageUrl: imageUrl,
        creator: req.userId,
    });

    post.save()
        .then((result) => {
            return User.findById(req.userId);
        })
        .then((user) => {
            creator = user;
            user.posts.push(post);
            return user.save();
        })
        .then((result) => {
            console.log(result);
            io.getIO().emit("posts", {
                action: "create",
                post: {
                    ...post._doc,
                    creator: { _id: req.userId, name: result.name },
                },
            });
            res.status(201).json({
                message: "Post Created successfully!",
                post: post,
                creator: { _id: creator._id, name: creator.name },
            });
        })
        .catch((err) => {
            if (!err.statusCode) {
                err.statusCode = 500;
            }
            next(err);
        });
};

exports.getPost = (req, res, next) => {
    const postId = req.params.postId;

    Post.findById(postId)
        .then((post) => {
            console.log(post);
            if (!post) {
                const error = new Error("Could not find post!");
                error.statusCode = 404;
                throw error;
            }
            res.status(200).json({ message: "Post Fetched", post: post });
        })
        .catch((err) => {
            if (!err.statusCode) {
                err.statusCode = 500;
            }
            next(err);
        });
};

exports.updatePost = (req, res, next) => {
    const postId = req.params.postId;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const err = new Error("Validation failed, entered data is incorrect!");
        err.statusCode = 422;
        throw err;
    }
    const title = req.body.title;
    const content = req.body.content;
    let imageUrl = req.body.image;

    if (req.file) {
        imageUrl = req.file.path.replace("\\", "/");
    }
    if (!imageUrl) {
        const err = new Error("No file picked!");
        err.statusCode = 422;
        throw err;
    }
    Post.findById(postId)
        .populate("creator")
        .then((post) => {
            if (!post) {
                const err = new Error("No post found!");
                err.statusCode = 422;
                throw err;
            }

            if (post.creator._id.toString() !== req.userId) {
                const err = new Error("Not authorized");
                err.statusCode = 403;
                throw err;
            }

            if (imageUrl !== post.imageUrl) {
                clearImage(post.imageUrl);
            }
            post.title = title;
            post.content = content;
            post.imageUrl = imageUrl;
            return post.save();
        })
        .then((result) => {
            io.getIO().emit("posts", { action: "update", post: result });
            res.status(200).json({ message: "Post Updated", post: result });
        })
        .catch((err) => {
            if (!err.statusCode) {
                err.statusCode = 500;
            }
            next(err);
        });
};

const clearImage = (filePath) => {
    filePath = path.join(__dirname, "..", filePath);
    fs.unlink(filePath, (err) => {
        if (err) {
            console.log("error while unlinking " + err);
        }
    });
};

exports.deletePost = (req, res, next) => {
    const postId = req.params.postId;

    Post.findById(postId)
        .then((post) => {
            if (!post) {
                const error = new Error("Could not find post!");
                error.statusCode = 404;
                throw error;
            }
            if (post.creator.toString() !== req.userId) {
                const err = new Error("Not authorized");
                err.statusCode = 403;
                throw err;
            }
            clearImage(post.imageUrl);
            return Post.findByIdAndRemove(postId);
        })
        .then(() => {
            return User.findById(req.userId);
        })
        .then((user) => {
            user.posts.pull(postId);
            return user.save();
        })
        .then(() => {
            io.getIO().emit("posts", { action: "delete", postId: postId });
            res.status(200).json({ message: "Post deleted successfully" });
        })
        .catch((err) => {
            if (!err.statusCode) {
                err.statusCode = 500;
            }
            next(err);
        });
};

import { Conversation, PrismaClient } from "@prisma/client";
import express from "express";
import cors from "cors";


const prisma = new PrismaClient();
const port: number = 80;
const app = express();

app.use(express.urlencoded({extended: true}));
app.use(express.json());
app.use(cors());

app.listen(port);
console.log(`Listening at port ${port}`);



async function loadLoggedUserId(req: express.Request, res: express.Response, next: CallableFunction) {
    if (req.header('X-User') == undefined) {
        res.status(400).json({ error: "X-User header missing" });
        return;
    }
    const loggedUserId = +req.header('X-User')!;
    if (isNaN(loggedUserId)) {
        res.status(400).json({ error: "invalid userId in X-User" });
        return;
    }

    res.locals.loggedUserId = loggedUserId;
    
    next();
}

async function conversations(req: express.Request, res: express.Response, descending: Boolean) {
    const conversations: Conversation[] = await prisma.conversation.findMany(
        {
            where: {
                participants: {
                    some: {
                        userId: res.locals.loggedUserId
                    }
                }
            },
            orderBy: {
                updatedAt: descending ? 'desc' : 'asc'
            },
            take: 10,
            include: { 
                participants: {
                    include: {
                        user: true
                    }
                },
                messages: {
                    where: { deletedAt: null },
                    include: { files: true, images: true, author: true },
                    orderBy: { sendAt: 'desc' }, 
                    take: 1 } 
                }
            }
    )
    res.json(conversations);
}



async function main() {
    /** Return all messages from DB (by user id (this is just a filter))
     * Body: (void)
     * Header X-User: logged user ID   
     */
    app.get("/conversation/:id([0-9]+)/messages", loadLoggedUserId, async (req: express.Request, res: express.Response) => {
        const conversationId = +req.params.id;
        
        const authorId = +req.query.author! || null;

        let conversation;
        if (!authorId) {
            conversation = await prisma.conversation.findFirst({
                where: {
                    id: conversationId,
                    participants: { some: { userId:  res.locals.loggedUserId } }
                },
                include: {
                    messages: {
                        orderBy: {
                            sendAt: "desc"
                        },
                        include: { 
                            files: true, images: true
                        }
                    }
                },
            });
        }
        else {
            conversation = await prisma.conversation.findFirst({
                where: {
                    id: conversationId,
                    participants: { some: { userId:  res.locals.loggedUserId } }
                },
                include: {
                    messages: { 
                        where: { 
                            authorId: authorId 
                        },
                        include: { 
                            files: true, images: true
                        } 
                    }
                }
            });
        }

        if (conversation == null) {
            res.status(404).json({ error: "conversation not found" });
            return;
        }

        res.json(conversation.messages);
    });

    
    /** Return 10 conversations with last message ordered by date
     * Body: (void)
     * Header X-User: logged user ID   
     */
    app.get("/conversation", loadLoggedUserId, async (req: express.Request, res: express.Response) => {
        res.header("Access-Control-Allow-Origin", "*");
        res.header(
            "Access-Control-Allow-Headers",
            "Origin, X-Requested-With, Content-Type, Accept, Authorization"
          );
        conversations(req, res, req.query?.sort == "-updated_at");
    });
    app.get('/conversation/recent', loadLoggedUserId, async (req: express.Request, res: express.Response) => {
        conversations(req, res, true);
    });


    /** Send message to conversation
     * Body: {
     *   content: string (text of the message)
     *   ( files: [ { filepath: string } ] )
     *   ( images: [ { filepath: string } ] )
     * }
     * Header X-User: logged user ID
     */
    app.post("/conversation/:conversationId([0-9]+)/message", loadLoggedUserId, async (req: express.Request, res: express.Response) => {
        const conversationId = +req.params.conversationId;
        const conversation = await prisma.conversation.findFirst({ 
            where: { 
                id: conversationId, 
                participants: {
                    some: {
                        userId: res.locals.loggedUserId
                    }
                }       
            }
        });
        if (conversation == null) {
            res.status(400).json({ error: "conversation not found" });
            return;
        }

        const author = await prisma.user.findUnique({ where: { id: res.locals.loggedUserId } });
        if (author == null) {
            res.status(40).json({ error: "author not found" });
            return;
        }
        
        try {
            const message = await prisma.message.create({
                data: {
                    authorId: author.id,
                    conversationId: conversation.id,
                    content: req.body.content,
                    files: {
                        create: req.body.files
                    },
                    images: {
                        create: req.body.images
                    }
                },
                include: {
                    files: true,
                    images: true
                }
            });
            if (message == null) {
                res.status(400).json({ error: "unknown error" });
            }
            
            await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } })

            res.json(message);
        }
        catch {
            res.status(400).json({ error: "invalid body" });
        }
    });


    /** Edit the message and mark it as edited
     * Body: {
     *   content: string (text of the message)
     *   ( filesAdd: [ { filepath: string } ] )
     *   ( filesDelete: [ fileId ] )
     *   ( imagesAdd: [ { filepath: string } ] )
     *   ( imagesDelete: [ imageId ] )
     * }
     * Header X-User: logged user ID
     */
    app.put("/conversation/:conversationId([0-9]+)/message/" + 
    ":messageUuid([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})", 
    loadLoggedUserId, async (req: express.Request, res: express.Response) => {
        const conversationId = +req.params.conversationId;

        const foundMessage = await prisma.message.findFirst({
            where: { 
                uuid: req.params.messageUuid,
                conversationId: conversationId,
                authorId: res.locals.loggedUserId
            }
        });
        if (foundMessage == null) {
            res.status(404).json({ error: "message not found" });
            return;
        }

        try {
            const message = await prisma.message.update({ 
                where: { 
                    uuid: req.params.messageUuid,
                },
                data: {
                    editedAt: new Date(),
                    content: req.body.content,
                    files: {
                        create: req.body.filesAdd,
                        deleteMany: {
                            id: {
                                in: req.body.filesDelete != undefined ? req.body.filesDelete : []
                            }                    
                        }
                    },
                    images: {
                        create: req.body.imagesAdd,
                        deleteMany: {
                            id: {
                                in: req.body.imagesDelete != undefined ? req.body.imagesDelete : []
                            }                    
                        }
                    }
                },
                include: {
                    files: true,
                    images: true
                }
            });
            res.json(message);
        }
        catch {
            res.status(400).json({ error: "invalid body" });
        }
    });


    /** Delete specified message (set hidden attribute or deleted_at)
     * Body: (void)
     * Header X-User: logged user ID
     */
    app.delete("/conversation/:conversationId([0-9]+)/message/:messageUuid([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})", 
    loadLoggedUserId, async (req: express.Request, res: express.Response) => {
        const conversationId = +req.params.conversationId;

        const message = await prisma.message.findFirst({ 
            where: { 
                uuid: req.params.messageUuid,
                conversationId: conversationId,
                authorId: res.locals.loggedUserId
            } 
        });
        if (message == null) {
            res.status(404).json({ error: "message not found" });
            return;
        }

        const deleteMessage = await prisma.message.update({ where: { uuid: message!.uuid }, data: { deletedAt: new Date() } });
        
        res.json(deleteMessage);
    });


    /** Create new conversation with users defined in request
     * Body: {
     *   participantIds: [ userId ]
     * }
     * Header X-User: logged user ID (-> default participant)
     */
    app.post("/conversation", loadLoggedUserId, async (req: express.Request, res: express.Response) => {
        try {
            req.body.participantIds.push(res.locals.loggedUserId);
            const participantIds: number[] = req.body.participantIds;

            const users = await prisma.user.findMany({
                where: {
                    id: {
                        in: participantIds
                    }
                }
            });
            if (users.length < 2 || users.length != participantIds.length) {
                res.status(400).json({ error: "invalid array of participants" });
                return;
            }
    
            const conversation = await prisma.conversation.create({ 
                data: { 
                    participants: {
                        createMany: {
                            data: users.map(user => ({ userId: user.id, isPinned: false }))
                        }
                    }
                },
                include: {
                    participants: true
                }
            });

            res.send(conversation);
        }
        catch (exception) {
            res.status(400).json({ error: "invalid body" });
            return;
        }
    });


    /** Get information about conversation, participants, last message
     * Body: (void)
     * Header X-User: logged user ID
     */
    app.get("/conversation/:id([0-9]+)", loadLoggedUserId, async (req: express.Request, res: express.Response) => {
        const conversationId = +req.params.id;

        const conversation = await prisma.conversation.findFirst({
            where: {
                id: conversationId,
                participants: {
                    some: {
                        userId: res.locals.loggedUserId
                    }
                }
            },
            include: {
                messages: { orderBy: { sendAt: 'desc' }, where: { deletedAt: null },  take: 1 },
                participants: true
            }
        });
        if (conversation == null) {
            res.status(400).json({ error: "conversation not found" });
            return;
        }

        const conversationInfo = { 
            participants: conversation?.participants,
            last_message: conversation?.messages[0]
        }

        res.json(conversationInfo);
    });
}


main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());

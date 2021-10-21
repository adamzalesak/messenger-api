import { Contact, Conversation, Message, PrismaClient, User } from '@prisma/client'


const prisma = new PrismaClient();


async function main() {
    const user0: User = await prisma.user.upsert({
        where: { email: "adam@gmail.com" },
        update: {},
        create: {
            name: "Adam",
            email: "adam@gmail.com",
            password: "heslo"
        }
    });
    const user1: User = await prisma.user.upsert({
        where: { email: "ben@gmail.com" },
        update: {},
        create: {
            name: "Ben",
            email: "ben@gmail.com",
            password: "heslo"
        }
    });
    const user2: User = await prisma.user.upsert({
        where: { email: "cyril@gmail.com" },
        update: {},
        create: {
            name: "Cyril",
            email: "cyril@gmail.com",
            password: "heslo"
        }
    });


    const contact1: Contact = await prisma.contact.create({
        data: {
            owner: { connect: { id: user0.id } },
            subject: { connect: { id: user1.id }}
        }
    });
    const contact2: Contact = await prisma.contact.create({
        data: {
            owner: { connect: { id: user0.id } },
            subject: { connect: { id: user2.id } }
        }
    });


    const conversation1: Conversation = await prisma.conversation.create({
        data: {
            participants:
            {
                create: 
                    [{ isPinned: false, user: { connect: { id: user0.id } } },
                    { isPinned: false, user: { connect: { id: user1.id } } }]
            }
        }
    });
    const conversation2: Conversation = await prisma.conversation.create({
        data: {
            participants:
                {
                    create:
                        [{ isPinned: false, user: { connect: { id: user0.id } } },
                            { isPinned: false, user: { connect: { id: user2.id } } }]
                }
        }
    });


    await prisma.message.create({
        data: {
            content: "Test message #1 (user0 -> user1)",
            author: { connect: { id: user0.id } },
            conversation: { connect: { id: contact1.id } }
        }
    });


    await prisma.message.create({
        data: {
            content: "Test message #2 (user0 -> user2)",
            author: { connect: { id: user0.id } },
            conversation: { connect: { id: contact2.id } }
        }
    });
    await prisma.message.create({
        data: {
            content: "Test message #3 (user2-> user0)",
            author: { connect: { id: user2.id } },
            conversation: { connect: { id: contact2.id } }
        }
    });
    await prisma.message.create({
        data: {
            content: "Test message #4 (user0 -> user2)",
            author: { connect: { id: user0.id } },
            conversation: { connect: { id: contact2.id } }
        }
    });
    await prisma.message.create({
        data: {
            content: "Test message #5 (user2-> user0)",
            author: { connect: { id: user2.id } },
            conversation: { connect: { id: contact2.id } }
        }
    });
    await prisma.message.create({
        data: {
            content: "Test message #6 (user0 -> user2)",
            author: { connect: { id: user0.id } },
            conversation: { connect: { id: contact2.id } }
        }
    });
}



main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
